import { randomUUID } from "node:crypto";
import { MAX_QUESTIONS_PER_RUN, isValidQuestionCount, normalizeAiSettings } from "./aiSettings.js";
import { pickChapterForDate } from "./chapterRotation.js";
import { collectValidQuestions } from "./collectValidQuestions.js";
import { TOTAL_CHAPTERS, getChapterName, isValidChapterNumber } from "./chapters.js";
import { FieldValue, Timestamp, aiDb, defaultDb } from "./firestore.js";
import { requestQuestionBatch } from "./generateQuestions.js";
import { normalizeQuestionText, validateGeneratedQuestion } from "./questionValidation.js";

export const MANUAL_RUNS_PER_DAY_LIMIT = 5;
const GENERATION_TRIGGERS = ["scheduled", "manual", "local"];
// Matches the functions' 1800 s timeout (src/index.js). A function takes the lock after it starts, so the lock
// outlives the function.
const GENERATION_LOCK_TTL_MS = 30 * 60 * 1000;
const MAX_RECORDED_ERRORS = 20;
const MAX_RECORDED_ERROR_LENGTH = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generates questions for one chapter and records the run in the ai database's generationRuns collection.
 * Shared by the weekly schedule, the Generate now callable and the local script.
 *
 * Outcomes that create no run doc: {status: "skipped" | "already_running" | "daily_limit_reached", reason}.
 * Otherwise: {runId, chapter, dryRun, requestedQuestionCount, generatedQuestionCount, status, errors, questions},
 * where status is "succeeded", "partial" or "failed" and each question has a pendingQuestionId (null on a dry run).
 * An unexpected error after the run doc exists marks the run failed, gets a `generationRunId` property, and is
 * rethrown.
 */
export async function runGeneration({
  trigger,
  chapterOverride,
  questionCountOverride,
  dryRun = false,
  requestedBy = null,
  anthropicClient,
  now = new Date(),
}) {
  if (!GENERATION_TRIGGERS.includes(trigger)) throw new Error(`Unknown generation trigger: ${trigger}`);
  if (chapterOverride != null && !isValidChapterNumber(chapterOverride)) {
    throw new Error(`chapterOverride must be an integer from 1 to ${TOTAL_CHAPTERS}, got ${chapterOverride}`);
  }
  if (questionCountOverride != null && !isValidQuestionCount(questionCountOverride)) {
    throw new Error(`questionCountOverride must be an integer from 1 to ${MAX_QUESTIONS_PER_RUN}, got ${questionCountOverride}`);
  }
  if (typeof dryRun !== "boolean") throw new Error(`dryRun must be a boolean, got ${dryRun}`);

  const settings = normalizeAiSettings((await defaultDb.doc("metadata/aiQuestions").get()).data());
  if (trigger === "scheduled" && !settings.generationEnabled) {
    return { status: "skipped", reason: "Weekly generation is turned off" };
  }

  const lockToken = await acquireGenerationLock(requestedBy ? `${trigger}:${requestedBy}` : trigger);
  if (!lockToken) return { status: "already_running", reason: "Another generation run is in progress" };

  try {
    if (trigger === "manual") {
      // Dry runs count too: they cost the same Claude tokens.
      const manualRunCount = await countManualRunsSince(new Date(now.getTime() - ONE_DAY_MS));
      if (manualRunCount >= MANUAL_RUNS_PER_DAY_LIMIT) {
        return {
          status: "daily_limit_reached",
          reason: `${manualRunCount} manual runs in the last 24 hours (limit ${MANUAL_RUNS_PER_DAY_LIMIT})`,
        };
      }
    }

    const chapter = chapterOverride ?? pickChapterForDate(now);
    const requestedQuestionCount = questionCountOverride ?? settings.questionsPerRun;

    const runRef = aiDb.collection("generationRuns").doc();
    await runRef.set({
      trigger,
      chapter,
      requestedQuestionCount,
      generatedQuestionCount: 0,
      status: "running",
      errors: [],
      dryRun,
      requestedBy,
      startedAt: FieldValue.serverTimestamp(),
      finishedAt: null,
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    });

    try {
      return await generateAndRecord({ runRef, trigger, chapter, requestedQuestionCount, dryRun, requestedBy, anthropicClient });
    } catch (error) {
      await markRunFailed(runRef, error);
      error.generationRunId = runRef.id;
      throw error;
    }
  } finally {
    await releaseGenerationLock(lockToken);
  }
}

/**
 * Reads the chapter context, collects valid questions from Claude, then writes the pending questions (unless it's a
 * dry run) and the finished run doc in one batch.
 */
async function generateAndRecord({ runRef, trigger, chapter, requestedQuestionCount, dryRun, requestedBy, anthropicClient }) {
  // Equality filters only: no composite indexes. Rejected pending questions are included on purpose, so their
  // topics aren't generated again.
  const [humanQuestionsSnapshot, liveAiQuestionsSnapshot, previousAiQuestionsSnapshot] = await Promise.all([
    defaultDb.collection("questions").where("chapter", "==", chapter).get(),
    defaultDb.collection("questionsAi").where("chapter", "==", chapter).get(),
    aiDb.collection("questionsAiPending").where("chapter", "==", chapter).get(),
  ]);
  const humanQuestions = sortByQuestionNumber(humanQuestionsSnapshot.docs.map((doc) => doc.data()));
  const liveAiQuestions = sortByQuestionNumber(liveAiQuestionsSnapshot.docs.map((doc) => doc.data()));
  const previousAiQuestions = previousAiQuestionsSnapshot.docs.map((doc) => doc.data());
  const contextQuestionTexts = [...humanQuestions, ...liveAiQuestions, ...previousAiQuestions]
    .map((existingQuestion) => existingQuestion.question)
    .filter((questionText) => typeof questionText === "string")
    .map(normalizeQuestionText);

  const chapterName = getChapterName(chapter);
  const collected = await collectValidQuestions({
    requestedQuestionCount,
    requestBatch: ({ questionCount, acceptedQuestions }) => requestQuestionBatch({
      anthropicClient,
      chapter,
      chapterName,
      humanQuestions,
      liveAiQuestions,
      previousAiQuestions,
      acceptedQuestions,
      questionCount,
    }),
    validate: (candidate, { acceptedQuestions }) => validateGeneratedQuestion(candidate, {
      existingQuestionTexts: new Set([
        ...contextQuestionTexts,
        ...acceptedQuestions.map((acceptedQuestion) => normalizeQuestionText(acceptedQuestion.question)),
      ]),
    }),
  });

  const generatedQuestionCount = collected.acceptedQuestions.length;
  const status = getRunStatus(generatedQuestionCount, requestedQuestionCount);
  const errors = collected.errors
    .slice(0, MAX_RECORDED_ERRORS)
    .map((errorMessage) => errorMessage.slice(0, MAX_RECORDED_ERROR_LENGTH));

  const writeBatch = aiDb.batch();
  const pendingQuestionIds = collected.acceptedQuestions.map((acceptedQuestion) => {
    if (dryRun) return null;
    const pendingQuestionRef = aiDb.collection("questionsAiPending").doc();
    writeBatch.set(pendingQuestionRef, {
      chapter,
      question: acceptedQuestion.question,
      choices: acceptedQuestion.choices,
      correctChoice: acceptedQuestion.correctChoice,
      explanation: acceptedQuestion.explanation,
      status: "pending",
      aiGenerated: true,
      generatedAt: FieldValue.serverTimestamp(),
      generationRunId: runRef.id,
      trigger,
      requestedBy,
      model: acceptedQuestion.model,
    });
    return pendingQuestionRef.id;
  });
  writeBatch.update(runRef, {
    generatedQuestionCount,
    status,
    errors,
    finishedAt: FieldValue.serverTimestamp(),
    model: collected.model,
    inputTokens: collected.inputTokens,
    outputTokens: collected.outputTokens,
  });
  await writeBatch.commit();

  return {
    runId: runRef.id,
    chapter,
    dryRun,
    requestedQuestionCount,
    generatedQuestionCount,
    status,
    errors,
    questions: collected.acceptedQuestions.map((acceptedQuestion, index) => ({
      chapter,
      question: acceptedQuestion.question,
      choices: acceptedQuestion.choices,
      correctChoice: acceptedQuestion.correctChoice,
      explanation: acceptedQuestion.explanation,
      pendingQuestionId: pendingQuestionIds[index],
    })),
  };
}

/**
 * "succeeded" when every requested question was generated, "partial" when some were, "failed" when none were.
 */
function getRunStatus(generatedQuestionCount, requestedQuestionCount) {
  if (generatedQuestionCount >= requestedQuestionCount) return "succeeded";
  return generatedQuestionCount > 0 ? "partial" : "failed";
}

/**
 * Returns a copy sorted by questionNumber.
 */
function sortByQuestionNumber(questions) {
  return [...questions].sort((first, second) => (Number(first.questionNumber) || 0) - (Number(second.questionNumber) || 0));
}

/**
 * Counts manual runs started since windowStart. A single range filter needs no composite index; the trigger is
 * checked in memory.
 */
async function countManualRunsSince(windowStart) {
  const recentRunsSnapshot = await aiDb
    .collection("generationRuns")
    .where("startedAt", ">=", Timestamp.fromDate(windowStart))
    .get();
  return recentRunsSnapshot.docs.filter((doc) => doc.get("trigger") === "manual").length;
}

/**
 * Takes locks/generation in the ai database unless an unexpired holder has it. Returns the lock token, or null when
 * another run holds the lock.
 */
async function acquireGenerationLock(owner) {
  const generationLockRef = aiDb.doc("locks/generation");
  const lockToken = randomUUID();
  const acquired = await aiDb.runTransaction(async (transaction) => {
    const lockDoc = await transaction.get(generationLockRef);
    const expiresAt = lockDoc.exists ? lockDoc.get("expiresAt") : null;
    if (expiresAt && expiresAt.toMillis() > Date.now()) return false;
    const acquiredAtMs = Date.now();
    transaction.set(generationLockRef, {
      lockToken,
      owner,
      acquiredAt: Timestamp.fromMillis(acquiredAtMs),
      expiresAt: Timestamp.fromMillis(acquiredAtMs + GENERATION_LOCK_TTL_MS),
    });
    return true;
  });
  return acquired ? lockToken : null;
}

/**
 * Deletes locks/generation if this run still holds it. Never throws: an unreleased lock expires on its own.
 */
async function releaseGenerationLock(lockToken) {
  const generationLockRef = aiDb.doc("locks/generation");
  try {
    await aiDb.runTransaction(async (transaction) => {
      const lockDoc = await transaction.get(generationLockRef);
      if (lockDoc.exists && lockDoc.get("lockToken") === lockToken) transaction.delete(generationLockRef);
    });
  } catch (error) {
    console.error("Failed to release the generation lock; it expires on its own:", error);
  }
}

/**
 * Records an unexpected error on the run doc. Never throws, so the original error is the one the caller sees.
 */
async function markRunFailed(runRef, error) {
  try {
    await runRef.update({
      status: "failed",
      errors: [String(error.message).slice(0, MAX_RECORDED_ERROR_LENGTH)],
      finishedAt: FieldValue.serverTimestamp(),
    });
  } catch (updateError) {
    console.error(`Failed to mark generation run ${runRef.id} as failed:`, updateError);
  }
}

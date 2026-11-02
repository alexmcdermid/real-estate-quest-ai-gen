import { randomUUID } from "node:crypto";
import { MAX_ITEMS_PER_RUN, isValidItemCount, normalizeAiSettings } from "./aiSettings.js";
import { pickChapterForDate } from "./chapterRotation.js";
import { TOTAL_CHAPTERS, isValidChapterNumber } from "./chapters.js";
import { generateValidItems, getContentTypeDefinition } from "./contentTypes.js";
import { FieldValue, Timestamp, aiDb, defaultDb } from "./firestore.js";

// Across both content types: each Generate now is one run.
export const MANUAL_RUNS_PER_DAY_LIMIT = 10;
const GENERATION_TRIGGERS = ["scheduled", "manual", "local"];
// Matches the functions' 1800 s timeout (src/index.js). A function takes the lock after it starts, so the lock
// outlives the function.
const GENERATION_LOCK_TTL_MS = 30 * 60 * 1000;
const MAX_RECORDED_ERRORS = 20;
const MAX_RECORDED_ERROR_LENGTH = 500;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Generates questions or flashcards for one chapter and records the run in the ai database's generationRuns
 * collection. Shared by the weekly schedule, the Generate now callable and the local script.
 *
 * Outcomes that create no run doc: {status: "skipped" | "already_running" | "daily_limit_reached", reason}.
 * Otherwise: {runId, contentType, chapter, dryRun, requestedItemCount, generatedItemCount, status, errors, items},
 * where status is "succeeded", "partial" or "failed" and each item (a question or a flashcard) has a
 * pendingDocumentId (null on a dry run).
 * An unexpected error after the run doc exists marks the run failed, gets a `generationRunId` property, and is
 * rethrown.
 */
export async function runGeneration({
  trigger,
  contentType,
  chapterOverride,
  itemCountOverride,
  dryRun = false,
  requestedBy = null,
  anthropicClient,
  now = new Date(),
}) {
  if (!GENERATION_TRIGGERS.includes(trigger)) throw new Error(`Unknown generation trigger: ${trigger}`);
  const { perRunSettingName } = getContentTypeDefinition(contentType); // throws for an unknown content type
  if (chapterOverride != null && !isValidChapterNumber(chapterOverride)) {
    throw new Error(`chapterOverride must be an integer from 1 to ${TOTAL_CHAPTERS}, got ${chapterOverride}`);
  }
  if (itemCountOverride != null && !isValidItemCount(itemCountOverride)) {
    throw new Error(`itemCountOverride must be an integer from 1 to ${MAX_ITEMS_PER_RUN}, got ${itemCountOverride}`);
  }
  if (typeof dryRun !== "boolean") throw new Error(`dryRun must be a boolean, got ${dryRun}`);

  const settings = normalizeAiSettings((await defaultDb.doc("metadata/aiContent").get()).data());
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
    const requestedItemCount = itemCountOverride ?? settings[perRunSettingName];

    const runRef = aiDb.collection("generationRuns").doc();
    await runRef.set({
      trigger,
      contentType,
      chapter,
      requestedItemCount,
      generatedItemCount: 0,
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
      return await generateAndRecord({
        runRef,
        trigger,
        contentType,
        chapter,
        requestedItemCount,
        dryRun,
        requestedBy,
        anthropicClient,
      });
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
 * Reads the chapter context, collects valid items from Claude, then writes the pending documents (unless it's a dry
 * run) and the finished run doc in one batch.
 */
async function generateAndRecord({
  runRef,
  trigger,
  contentType,
  chapter,
  requestedItemCount,
  dryRun,
  requestedBy,
  anthropicClient,
}) {
  const definition = getContentTypeDefinition(contentType);
  // Equality filters only: no composite indexes. Rejected pending documents are included on purpose, so their
  // topics and terms aren't generated again. The chapter's items are the prompt's context; a content type whose
  // duplicate check covers every chapter also reads every chapter's items.
  const [humanItemsSnapshot, liveAiItemsSnapshot, previousAiItemsSnapshot, everyChapterItems] = await Promise.all([
    defaultDb.collection(definition.humanCollectionName).where("chapter", "==", chapter).get(),
    defaultDb.collection(definition.liveAiCollectionName).where("chapter", "==", chapter).get(),
    aiDb.collection(definition.pendingCollectionName).where("chapter", "==", chapter).get(),
    definition.duplicateCheckCoversEveryChapter ? readEveryChapterDuplicateCheckFields(definition) : undefined,
  ]);

  const collected = await generateValidItems({
    contentType,
    anthropicClient,
    chapter,
    humanItems: humanItemsSnapshot.docs.map((doc) => doc.data()),
    liveAiItems: liveAiItemsSnapshot.docs.map((doc) => doc.data()),
    previousAiItems: previousAiItemsSnapshot.docs.map((doc) => doc.data()),
    everyChapterItems,
    requestedItemCount,
  });

  const generatedItemCount = collected.acceptedItems.length;
  const status = getRunStatus(generatedItemCount, requestedItemCount);
  const errors = collected.errors
    .slice(0, MAX_RECORDED_ERRORS)
    .map((errorMessage) => errorMessage.slice(0, MAX_RECORDED_ERROR_LENGTH));

  const writeBatch = aiDb.batch();
  // generatedFields: question, choices, correctChoice, explanation, or front, back, tags, difficulty, as validated.
  const items = collected.acceptedItems.map(({ model, ...generatedFields }) => {
    let pendingDocumentId = null;
    if (!dryRun) {
      const pendingDocumentRef = aiDb.collection(definition.pendingCollectionName).doc();
      writeBatch.set(pendingDocumentRef, {
        chapter,
        ...generatedFields,
        status: "pending",
        aiGenerated: true,
        generatedAt: FieldValue.serverTimestamp(),
        generationRunId: runRef.id,
        trigger,
        requestedBy,
        model,
      });
      pendingDocumentId = pendingDocumentRef.id;
    }
    return { chapter, ...generatedFields, pendingDocumentId };
  });
  writeBatch.update(runRef, {
    generatedItemCount,
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
    contentType,
    chapter,
    dryRun,
    requestedItemCount,
    generatedItemCount,
    status,
    errors,
    items,
  };
}

/**
 * Reads the duplicate check field (a flashcard's front) of every human, live AI and generated item in every
 * chapter, whatever its status. Only that field is downloaded.
 *
 * @return {Promise<object[]>} one object per document, e.g. {front}, or {} when a document has no such field
 */
async function readEveryChapterDuplicateCheckFields(definition) {
  const { duplicateCheckFieldName } = definition;
  const snapshots = await Promise.all([
    defaultDb.collection(definition.humanCollectionName).select(duplicateCheckFieldName).get(),
    defaultDb.collection(definition.liveAiCollectionName).select(duplicateCheckFieldName).get(),
    aiDb.collection(definition.pendingCollectionName).select(duplicateCheckFieldName).get(),
  ]);
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data()));
}

/**
 * "succeeded" when every requested item was generated, "partial" when some were, "failed" when none were.
 */
function getRunStatus(generatedItemCount, requestedItemCount) {
  if (generatedItemCount >= requestedItemCount) return "succeeded";
  return generatedItemCount > 0 ? "partial" : "failed";
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

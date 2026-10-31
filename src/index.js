import Anthropic from "@anthropic-ai/sdk";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { MAX_QUESTIONS_PER_RUN, isValidQuestionCount } from "./aiSettings.js";
import { TOTAL_CHAPTERS, isValidChapterNumber } from "./chapters.js";
import { MANUAL_RUNS_PER_DAY_LIMIT, runGeneration } from "./runGeneration.js";

// Without serviceAccount the functions run as the default compute account, which can write every database.
const AI_GEN_SERVICE_ACCOUNT_EMAIL = "ai-gen@real-estate-quest.iam.gserviceaccount.com";
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

export const generateAiQuestions = onSchedule(
  {
    schedule: "0 9 * * 1", // Mondays at 9:00 AM
    timeZone: "America/Los_Angeles",
    region: "us-west1",
    serviceAccount: AI_GEN_SERVICE_ACCOUNT_EMAIL,
    secrets: [anthropicApiKey],
    // A 10-question run at high effort can take longer than 9 minutes. 1800 s is the most the Firebase CLI allows a
    // scheduled function (Cloud Scheduler's maximum attempt deadline). locks/generation's TTL outlives it.
    timeoutSeconds: 1800,
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    try {
      const outcome = await runGeneration({
        trigger: "scheduled",
        anthropicClient: new Anthropic({ apiKey: anthropicApiKey.value() }),
      });
      logOutcome("Weekly AI question generation", outcome);
    } catch (error) {
      // Nothing recorded yet: fail the invocation so the error shows up in Cloud Scheduler and Error Reporting.
      if (!error.generationRunId) throw error;
      // Already recorded on the run doc. Rethrowing wouldn't help: there are no Scheduler retries.
      console.error(`Weekly AI question generation failed (generationRuns/${error.generationRunId}):`, error);
    }
  },
);

export const generateAiQuestionsNow = onCall(
  {
    region: "us-west1",
    enforceAppCheck: true,
    serviceAccount: AI_GEN_SERVICE_ACCOUNT_EMAIL,
    secrets: [anthropicApiKey],
    timeoutSeconds: 1800, // Same as generateAiQuestions
    memory: "512MiB",
  },
  async (request) => {
    const authContext = request.auth;
    if (!authContext || !authContext.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    if (!authContext.token?.isAdmin) {
      throw new HttpsError("permission-denied", "Admin access required");
    }

    const { chapter, questionCount, dryRun } = parseGenerateNowInput(request.data);
    console.log(`Generate now requested by ${authContext.uid}:`, { chapter, questionCount, dryRun });

    let outcome;
    try {
      // Ignores the weekly generation switch, so runs can be tried before the schedule is turned on.
      outcome = await runGeneration({
        trigger: "manual",
        chapterOverride: chapter,
        questionCountOverride: questionCount,
        dryRun,
        requestedBy: authContext.uid,
        anthropicClient: new Anthropic({ apiKey: anthropicApiKey.value() }),
      });
    } catch (error) {
      console.error("Generate now failed:", error);
      const message = error.generationRunId ?
        "AI question generation failed. The error is recorded in the recent generation runs." :
        "AI question generation failed";
      throw new HttpsError("internal", message);
    }

    if (outcome.status === "already_running") {
      throw new HttpsError("aborted", "A generation run is already in progress. Try again in a few minutes.");
    }
    if (outcome.status === "daily_limit_reached") {
      throw new HttpsError(
        "resource-exhausted",
        `The limit of ${MANUAL_RUNS_PER_DAY_LIMIT} manual generation runs per 24 hours was reached. Try again later.`,
      );
    }
    logOutcome("Generate now", outcome);
    return outcome;
  },
);

/**
 * Validates the Generate now input. A missing (undefined or null) chapter means this week's chapter, and a missing
 * questionCount means the questionsPerRun setting.
 */
function parseGenerateNowInput(data) {
  const chapter = data?.chapter ?? null;
  const questionCount = data?.questionCount ?? null;
  const dryRun = data?.dryRun ?? false;
  if (chapter !== null && !isValidChapterNumber(chapter)) {
    throw new HttpsError("invalid-argument", `chapter must be an integer from 1 to ${TOTAL_CHAPTERS}`);
  }
  if (questionCount !== null && !isValidQuestionCount(questionCount)) {
    throw new HttpsError("invalid-argument", `questionCount must be an integer from 1 to ${MAX_QUESTIONS_PER_RUN}`);
  }
  if (typeof dryRun !== "boolean") {
    throw new HttpsError("invalid-argument", "dryRun must be a boolean");
  }
  return { chapter, questionCount, dryRun };
}

/**
 * Logs a one-line summary of a runGeneration outcome.
 */
function logOutcome(label, outcome) {
  if (!outcome.runId) {
    console.log(`${label}: ${outcome.status} (${outcome.reason})`);
    return;
  }
  console.log(
    `${label}: run ${outcome.runId} ${outcome.status}, chapter ${outcome.chapter}, ` +
      `${outcome.generatedQuestionCount} of ${outcome.requestedQuestionCount} questions${outcome.dryRun ? " (dry run)" : ""}`,
    outcome.errors,
  );
}

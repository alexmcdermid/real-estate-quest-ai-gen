import Anthropic from "@anthropic-ai/sdk";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { MAX_ITEMS_PER_RUN, isValidItemCount } from "./aiSettings.js";
import { TOTAL_CHAPTERS, isValidChapterNumber } from "./chapters.js";
import { CONTENT_TYPES } from "./contentTypes.js";
import { MANUAL_RUNS_PER_DAY_LIMIT, runGeneration } from "./runGeneration.js";

// Without serviceAccount the functions run as the default compute account, which can write every database.
const AI_GEN_SERVICE_ACCOUNT_EMAIL = "ai-gen@real-estate-quest.iam.gserviceaccount.com";
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

export const generateAiContent = onSchedule(
  {
    schedule: "0 9 * * 1", // Mondays at 9:00 AM
    timeZone: "America/Los_Angeles",
    region: "us-west1",
    serviceAccount: AI_GEN_SERVICE_ACCOUNT_EMAIL,
    secrets: [anthropicApiKey],
    // A 10-question run at high effort can take longer than 9 minutes. 1800 s is the most the Firebase CLI allows a
    // scheduled function (Cloud Scheduler's maximum attempt deadline), and both runs share it. Each run's
    // locks/generation TTL outlives the function.
    timeoutSeconds: 1800,
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    const anthropicClient = new Anthropic({ apiKey: anthropicApiKey.value() });
    // One date for both runs, so both get this week's chapter.
    const now = new Date();
    let firstUnrecordedError = null;
    // The questions run, then the flashcards run: each takes locks/generation and records its own run.
    for (const contentType of CONTENT_TYPES) {
      const label = `Weekly generation of AI ${contentType}`;
      try {
        logOutcome(label, await runGeneration({ trigger: "scheduled", contentType, anthropicClient, now }));
      } catch (error) {
        if (error.generationRunId) {
          // Already recorded on the run doc. Rethrowing wouldn't help: there are no Scheduler retries.
          console.error(`${label} failed (generationRuns/${error.generationRunId}):`, error);
        } else {
          console.error(`${label} failed before recording a run:`, error);
          firstUnrecordedError ??= error;
        }
      }
    }
    // No run doc holds that error: fail the invocation so Cloud Scheduler shows the failure.
    if (firstUnrecordedError) throw firstUnrecordedError;
  },
);

export const generateAiContentNow = onCall(
  {
    region: "us-west1",
    enforceAppCheck: true,
    serviceAccount: AI_GEN_SERVICE_ACCOUNT_EMAIL,
    secrets: [anthropicApiKey],
    timeoutSeconds: 1800, // Same as generateAiContent
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

    const { contentType, chapter, itemCount, dryRun } = parseGenerateNowInput(request.data);
    console.log(`Generate now requested by ${authContext.uid}:`, { contentType, chapter, itemCount, dryRun });

    let outcome;
    try {
      // Ignores the weekly generation switch, so runs can be tried before the schedule is turned on.
      outcome = await runGeneration({
        trigger: "manual",
        contentType,
        chapterOverride: chapter,
        itemCountOverride: itemCount,
        dryRun,
        requestedBy: authContext.uid,
        anthropicClient: new Anthropic({ apiKey: anthropicApiKey.value() }),
      });
    } catch (error) {
      console.error("Generate now failed:", error);
      const message = error.generationRunId ?
        `Generating AI ${contentType} failed. The error is recorded in the recent generation runs.` :
        `Generating AI ${contentType} failed`;
      throw new HttpsError("internal", message);
    }

    if (outcome.status === "already_running") {
      throw new HttpsError("aborted", "A generation run is already in progress. Try again in a few minutes.");
    }
    if (outcome.status === "daily_limit_reached") {
      throw new HttpsError(
        "resource-exhausted",
        `The limit of ${MANUAL_RUNS_PER_DAY_LIMIT} manual generation runs per 24 hours (questions and flashcards ` +
          "together) was reached. Try again later.",
      );
    }
    logOutcome(`Generate now (${contentType})`, outcome);
    return outcome;
  },
);

/**
 * Validates the Generate now input. contentType is required. A missing (undefined or null) chapter means this week's
 * chapter, and a missing itemCount means the content type's per-run setting (questionsPerRun or flashcardsPerRun).
 */
function parseGenerateNowInput(data) {
  const contentType = data?.contentType;
  const chapter = data?.chapter ?? null;
  const itemCount = data?.itemCount ?? null;
  const dryRun = data?.dryRun ?? false;
  if (!CONTENT_TYPES.includes(contentType)) {
    throw new HttpsError("invalid-argument", `contentType must be one of: ${CONTENT_TYPES.join(", ")}`);
  }
  if (chapter !== null && !isValidChapterNumber(chapter)) {
    throw new HttpsError("invalid-argument", `chapter must be an integer from 1 to ${TOTAL_CHAPTERS}`);
  }
  if (itemCount !== null && !isValidItemCount(itemCount)) {
    throw new HttpsError("invalid-argument", `itemCount must be an integer from 1 to ${MAX_ITEMS_PER_RUN}`);
  }
  if (typeof dryRun !== "boolean") {
    throw new HttpsError("invalid-argument", "dryRun must be a boolean");
  }
  return { contentType, chapter, itemCount, dryRun };
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
      `${outcome.generatedItemCount} of ${outcome.requestedItemCount} ${outcome.contentType}` +
      `${outcome.dryRun ? " (dry run)" : ""}`,
    outcome.errors,
  );
}

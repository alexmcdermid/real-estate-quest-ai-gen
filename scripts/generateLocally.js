// Runs one generation from your machine: npm run generate:local (settings in local-generation.env, see dev.md).
// Firestore access uses your Application Default Credentials (gcloud auth application-default login).
import Anthropic from "@anthropic-ai/sdk";
import { aiDb, defaultDb } from "../src/firestore.js";
import { runGeneration } from "../src/runGeneration.js";

try {
  const outcome = await runGeneration({
    trigger: "local",
    chapterOverride: Number(process.env.CHAPTER_OVERRIDE) || undefined,
    questionCountOverride: Number(process.env.QUESTION_COUNT) || undefined,
    dryRun: process.env.DRY_RUN === "true",
    anthropicClient: new Anthropic(),
  });
  console.log(JSON.stringify(outcome, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Close the Firestore clients so the process exits as soon as the run is done. A client that never connected
  // (for example because credentials are missing) fails to close with the error already printed above.
  await Promise.allSettled([defaultDb.terminate(), aiDb.terminate()]);
}

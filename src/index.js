import { fetchChapterQuestions } from "./fetchQuestions.js";
import { generateQuestion } from "./generateQuestion.js";
import { getLastAiQuestionNumber, getExistingAiQuestions, writePendingQuestion } from "./writeToFirestore.js";

const TOTAL_CHAPTERS = 20;

function pickChapter() {
  // Rotate through chapters week by week based on the current ISO week number
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return ((week - 1) % TOTAL_CHAPTERS) + 1;
}

async function run() {
  const dryRun = process.env.DRY_RUN === "true";
  const chapter = Number(process.env.CHAPTER_OVERRIDE) || pickChapter();

  console.log(`Mode: ${dryRun ? "DRY RUN (no write)" : "live"}`);
  console.log(`Generating question for chapter ${chapter}`);

  const [existingQuestions, aiQuestions, lastNumber] = await Promise.all([
    fetchChapterQuestions(chapter),
    getExistingAiQuestions(chapter),
    getLastAiQuestionNumber(chapter),
  ]);

  console.log(`Fetched ${existingQuestions.length} human-written questions and ${aiQuestions.length} existing AI questions for chapter ${chapter}`);

  const nextQuestionNumber = lastNumber + 1;

  const newQuestion = await generateQuestion(chapter, existingQuestions, aiQuestions, nextQuestionNumber);

  if (dryRun) {
    console.log("\n--- GENERATED QUESTION (dry run) ---");
    console.log(JSON.stringify(newQuestion, null, 2));
    console.log("--- END ---\n");
    console.log("Dry run complete. Nothing written to Firestore.");
    return;
  }

  await writePendingQuestion(newQuestion);
  console.log("Done.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

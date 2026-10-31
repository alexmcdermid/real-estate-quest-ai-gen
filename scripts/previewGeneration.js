// Previews one generation without Firebase: npm run preview:local (settings in local-generation.env, see dev.md).
// Reads the chapter's human questions from a local checkout of real-estate-quest-questions, asks Claude exactly as the
// functions do, and prints the valid questions the way the AI questions repo stores them. Nothing is written to
// Firestore or GitHub.
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_QUESTIONS_PER_RUN, isValidQuestionCount } from "../src/aiSettings.js";
import { pickChapterForDate } from "../src/chapterRotation.js";
import { TOTAL_CHAPTERS, getChapterName, getManualChapters, isValidChapterNumber } from "../src/chapters.js";
import { collectValidQuestions } from "../src/collectValidQuestions.js";
import { requestQuestionBatch } from "../src/generateQuestions.js";
import { normalizeQuestionText, validateGeneratedQuestion } from "../src/questionValidation.js";

const DEFAULT_PREVIEW_QUESTION_COUNT = 2;

const questionsRepoPath = process.env.QUESTIONS_REPO_PATH || "../real-estate-quest-questions";
const chapter = process.env.CHAPTER_OVERRIDE ? Number(process.env.CHAPTER_OVERRIDE) : pickChapterForDate(new Date());
const requestedQuestionCount = process.env.QUESTION_COUNT ?
  Number(process.env.QUESTION_COUNT) :
  DEFAULT_PREVIEW_QUESTION_COUNT;
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY isn't set: add it to local-generation.env (see local-generation.env.example) or export it");
}
if (!isValidChapterNumber(chapter)) {
  throw new Error(`CHAPTER_OVERRIDE must be an integer from 1 to ${TOTAL_CHAPTERS}, got ${process.env.CHAPTER_OVERRIDE}`);
}
if (!isValidQuestionCount(requestedQuestionCount)) {
  throw new Error(`QUESTION_COUNT must be an integer from 1 to ${MAX_QUESTIONS_PER_RUN}, got ${process.env.QUESTION_COUNT}`);
}

// The human question files are JSON arrays despite the .js extension.
const humanQuestions = JSON.parse(await readFile(path.join(questionsRepoPath, `${chapter}.js`), "utf8"))
  .sort((first, second) => first.questionNumber - second.questionNumber);
const humanQuestionTexts = humanQuestions.map((humanQuestion) => normalizeQuestionText(humanQuestion.question));

const anthropicClient = new Anthropic();
const collected = await collectValidQuestions({
  requestedQuestionCount,
  requestBatch: ({ questionCount, acceptedQuestions }) => requestQuestionBatch({
    anthropicClient,
    chapter,
    chapterName: getChapterName(chapter),
    manualChapters: getManualChapters(chapter),
    humanQuestions,
    liveAiQuestions: [],
    previousAiQuestions: [],
    acceptedQuestions,
    questionCount,
  }),
  validate: (candidate, { acceptedQuestions }) => validateGeneratedQuestion(candidate, {
    existingQuestionTexts: new Set([
      ...humanQuestionTexts,
      ...acceptedQuestions.map((acceptedQuestion) => normalizeQuestionText(acceptedQuestion.question)),
    ]),
  }),
});

// Approval sets questionNumber, premium and aiQuestionId. These are the values the first approvals in an empty
// chapter file would get, with premium at the review screen's default.
const previewEntries = collected.acceptedQuestions.map((acceptedQuestion, index) => ({
  chapter,
  questionNumber: index + 1,
  question: acceptedQuestion.question,
  choices: acceptedQuestion.choices,
  correctChoice: acceptedQuestion.correctChoice,
  premium: true,
  explanation: acceptedQuestion.explanation,
  aiGenerated: true,
  aiQuestionId: `preview-${index + 1}`,
}));
const previewFileContent = JSON.stringify(previewEntries, null, 2) + "\n";

process.stdout.write(previewFileContent);
console.error(
  `Chapter ${chapter} (${getChapterName(chapter)}): ${previewEntries.length} of ${requestedQuestionCount} questions ` +
    `valid, model ${collected.model}, ${collected.inputTokens} input and ${collected.outputTokens} output tokens`,
);
for (const errorMessage of collected.errors) console.error(errorMessage);

if (process.env.PREVIEW_OUTPUT_FILE) {
  await writeFile(process.env.PREVIEW_OUTPUT_FILE, previewFileContent);
  console.error(`Wrote ${process.env.PREVIEW_OUTPUT_FILE}`);
}
if (previewEntries.length < requestedQuestionCount) process.exitCode = 1;

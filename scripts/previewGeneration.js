// Previews one generation without Firebase: npm run preview:local (settings in local-generation.env, see dev.md).
// Reads the chapter's human questions or flashcards (CONTENT_TYPE; for flashcards also every other chapter's cards,
// which a new card must not repeat) from a local checkout of real-estate-quest-questions, asks Claude exactly as the
// functions do, and prints the valid ones the way the AI repo stores them. Nothing is written to Firestore or GitHub.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MAX_ITEMS_PER_RUN, isValidItemCount } from "../src/aiSettings.js";
import { pickChapterForDate } from "../src/chapterRotation.js";
import { TOTAL_CHAPTERS, getChapterName, isValidChapterNumber } from "../src/chapters.js";
import { CONTENT_TYPES, generateValidItems } from "../src/contentTypes.js";

const DEFAULT_PREVIEW_ITEM_COUNT = 2;

const contentType = process.env.CONTENT_TYPE || "questions";
const questionsRepoPath = process.env.QUESTIONS_REPO_PATH || "../real-estate-quest-questions";
const chapter = process.env.CHAPTER_OVERRIDE ? Number(process.env.CHAPTER_OVERRIDE) : pickChapterForDate(new Date());
const requestedItemCount = process.env.ITEM_COUNT ? Number(process.env.ITEM_COUNT) : DEFAULT_PREVIEW_ITEM_COUNT;
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY isn't set: add it to local-generation.env (see local-generation.env.example) or export it");
}
if (!CONTENT_TYPES.includes(contentType)) {
  throw new Error(`CONTENT_TYPE must be one of: ${CONTENT_TYPES.join(", ")}, got ${process.env.CONTENT_TYPE}`);
}
if (!isValidChapterNumber(chapter)) {
  throw new Error(`CHAPTER_OVERRIDE must be an integer from 1 to ${TOTAL_CHAPTERS}, got ${process.env.CHAPTER_OVERRIDE}`);
}
if (!isValidItemCount(requestedItemCount)) {
  throw new Error(`ITEM_COUNT must be an integer from 1 to ${MAX_ITEMS_PER_RUN}, got ${process.env.ITEM_COUNT}`);
}

// Per content type: where the human files keep the chapter's items (and, for a duplicate check that covers every
// chapter, every chapter's items), and the entry an approval appends to the AI repo file. Approval sets the number,
// premium and the ids (and a flashcard's documentID); these are the values the first approvals in an empty chapter
// file would get, with premium at the review screen's default. The human files are JSON arrays despite the .js
// extension.
const previewFormats = {
  questions: {
    readHumanItems: async () => ({
      chapterHumanItems: JSON.parse(await readFile(path.join(questionsRepoPath, `${chapter}.js`), "utf8")),
    }),
    toAiRepoEntry: (acceptedQuestion, index) => ({
      chapter,
      questionNumber: index + 1,
      question: acceptedQuestion.question,
      choices: acceptedQuestion.choices,
      correctChoice: acceptedQuestion.correctChoice,
      premium: true,
      explanation: acceptedQuestion.explanation,
      aiGenerated: true,
      aiQuestionId: `preview-${index + 1}`,
    }),
  },
  flashcards: {
    // One file for every chapter: the chapter's cards are the style reference, and a new card must not repeat any
    // chapter's card.
    readHumanItems: async () => {
      const everyChapterHumanItems = JSON.parse(await readFile(path.join(questionsRepoPath, "flashcards.js"), "utf8"));
      return {
        chapterHumanItems: everyChapterHumanItems.filter((humanFlashcard) => humanFlashcard.chapter === chapter),
        everyChapterHumanItems,
      };
    },
    toAiRepoEntry: (acceptedFlashcard, index) => ({
      documentID: randomUUID(),
      cardNumber: index + 1,
      front: acceptedFlashcard.front,
      back: acceptedFlashcard.back,
      chapter,
      tags: acceptedFlashcard.tags,
      premium: true,
      difficulty: acceptedFlashcard.difficulty,
      aiGenerated: true,
      aiFlashcardId: `preview-${index + 1}`,
    }),
  },
};
const previewFormat = previewFormats[contentType];
const { chapterHumanItems, everyChapterHumanItems } = await previewFormat.readHumanItems();

const collected = await generateValidItems({
  contentType,
  anthropicClient: new Anthropic(),
  chapter,
  humanItems: chapterHumanItems,
  liveAiItems: [],
  previousAiItems: [],
  everyChapterItems: everyChapterHumanItems,
  requestedItemCount,
});

const previewEntries = collected.acceptedItems.map(previewFormat.toAiRepoEntry);
const previewFileContent = JSON.stringify(previewEntries, null, 2) + "\n";

process.stdout.write(previewFileContent);
console.error(
  `Chapter ${chapter} (${getChapterName(chapter)}): ${previewEntries.length} of ${requestedItemCount} ${contentType} ` +
    `valid, model ${collected.model}, ${collected.inputTokens} input and ${collected.outputTokens} output tokens`,
);
for (const errorMessage of collected.errors) console.error(errorMessage);

if (process.env.PREVIEW_OUTPUT_FILE) {
  await writeFile(process.env.PREVIEW_OUTPUT_FILE, previewFileContent);
  console.error(`Wrote ${process.env.PREVIEW_OUTPUT_FILE}`);
}
if (previewEntries.length < requestedItemCount) process.exitCode = 1;

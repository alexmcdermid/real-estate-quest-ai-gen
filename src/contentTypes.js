// What differs between generating questions and generating flashcards, and the generation steps both share. No
// Firestore imports, so the preview script can use it.
import { getChapterName, getManualChapters } from "./chapters.js";
import { collectValidItems } from "./collectValidItems.js";
import { validateGeneratedFlashcard } from "./flashcardValidation.js";
import { requestFlashcardBatch } from "./generateFlashcards.js";
import { requestQuestionBatch } from "./generateQuestions.js";
import { COURSE_GLOSSARY_TERMS } from "./glossaryTerms.js";
import { validateGeneratedQuestion } from "./questionValidation.js";
import { normalizeForDuplicateCheck } from "./textChecks.js";

const contentTypeDefinitions = {
  questions: {
    itemName: "question",
    perRunSettingName: "questionsPerRun",
    humanCollectionName: "questions",
    liveAiCollectionName: "questionsAi",
    pendingCollectionName: "questionsAiPending",
    itemNumberFieldName: "questionNumber",
    duplicateCheckFieldName: "question",
    duplicateCheckCoversEveryChapter: false,
    requestBatch: (batchRequest) => requestQuestionBatch({
      anthropicClient: batchRequest.anthropicClient,
      chapter: batchRequest.chapter,
      chapterName: batchRequest.chapterName,
      manualChapters: batchRequest.manualChapters,
      humanQuestions: batchRequest.humanItems,
      liveAiQuestions: batchRequest.liveAiItems,
      previousAiQuestions: batchRequest.previousAiItems,
      acceptedQuestions: batchRequest.acceptedItems,
      questionCount: batchRequest.itemCount,
    }),
    validate: (candidate, existingNormalizedTexts) => {
      const validation = validateGeneratedQuestion(candidate, { existingQuestionTexts: existingNormalizedTexts });
      return validation.valid ? { valid: true, item: validation.question } : validation;
    },
  },
  flashcards: {
    itemName: "flashcard",
    perRunSettingName: "flashcardsPerRun",
    humanCollectionName: "flashcards",
    liveAiCollectionName: "flashcardsAi",
    pendingCollectionName: "flashcardsAiPending",
    itemNumberFieldName: "cardNumber",
    duplicateCheckFieldName: "front",
    // A term gets one card in the whole course: the human deck repeats no front across chapters, and the glossary
    // covers every chapter.
    duplicateCheckCoversEveryChapter: true,
    requestBatch: (batchRequest) => requestFlashcardBatch({
      anthropicClient: batchRequest.anthropicClient,
      chapter: batchRequest.chapter,
      chapterName: batchRequest.chapterName,
      manualChapters: batchRequest.manualChapters,
      glossaryTermsWithoutFlashcard: getGlossaryTermsWithoutFlashcard(batchRequest.existingNormalizedTexts),
      humanFlashcards: batchRequest.humanItems,
      liveAiFlashcards: batchRequest.liveAiItems,
      previousAiFlashcards: batchRequest.previousAiItems,
      acceptedFlashcards: batchRequest.acceptedItems,
      flashcardCount: batchRequest.itemCount,
    }),
    validate: (candidate, existingNormalizedTexts) => {
      const validation = validateGeneratedFlashcard(candidate, { existingFronts: existingNormalizedTexts });
      return validation.valid ? { valid: true, item: validation.flashcard } : validation;
    },
  },
};

// Each is also the contentType recorded on its generationRuns documents.
export const CONTENT_TYPES = Object.keys(contentTypeDefinitions);

/**
 * Returns the content type's definition, or throws for an unknown content type.
 *
 * @param {string} contentType - "questions" or "flashcards"
 * @return {object} itemName (singular, for messages), perRunSettingName (in the AI settings), humanCollectionName and
 *   liveAiCollectionName (in the (default) database), pendingCollectionName (in the ai database), itemNumberFieldName,
 *   duplicateCheckFieldName (the text a new item must not repeat), duplicateCheckCoversEveryChapter (whether that
 *   text must not repeat any chapter's item, or only the chapter's), requestBatch and validate
 */
export function getContentTypeDefinition(contentType) {
  if (!CONTENT_TYPES.includes(contentType)) {
    throw new Error(`contentType must be one of: ${CONTENT_TYPES.join(", ")}, got ${contentType}`);
  }
  return contentTypeDefinitions[contentType];
}

/**
 * Asks Claude for requestedItemCount new items of one content type for one chapter (up to 3 attempts) and returns
 * collectValidItems' result. humanItems, liveAiItems and previousAiItems are the chapter's existing items in any
 * order: the prompt lists them (human and live AI ones by number), and no new item may repeat one's text.
 * everyChapterItems is required when the content type's duplicate check covers every chapter (flashcards): every
 * existing item of every chapter (human, live AI and generated before, whatever its status), of which only the
 * duplicate check field is read. No new item may repeat one's text either, but the prompt doesn't list them; the
 * flashcard prompt offers only the glossary terms none of the existing cards covers.
 */
export function generateValidItems({
  contentType,
  anthropicClient,
  chapter,
  humanItems,
  liveAiItems,
  previousAiItems,
  everyChapterItems,
  requestedItemCount,
}) {
  const definition = getContentTypeDefinition(contentType);
  if (definition.duplicateCheckCoversEveryChapter && !Array.isArray(everyChapterItems)) {
    throw new Error(`everyChapterItems must be an array for ${contentType}, got ${everyChapterItems}`);
  }
  const sortedHumanItems = sortByItemNumber(humanItems, definition.itemNumberFieldName);
  const sortedLiveAiItems = sortByItemNumber(liveAiItems, definition.itemNumberFieldName);
  // Everything that existed before this run. It never changes during the run, so neither does the prompt's cached
  // block.
  const existingNormalizedTexts = new Set(
    [...humanItems, ...liveAiItems, ...previousAiItems, ...(everyChapterItems ?? [])]
      .map((existingItem) => existingItem[definition.duplicateCheckFieldName])
      .filter((duplicateCheckText) => typeof duplicateCheckText === "string")
      .map(normalizeForDuplicateCheck),
  );
  const chapterName = getChapterName(chapter);
  const manualChapters = getManualChapters(chapter);

  return collectValidItems({
    requestedItemCount,
    itemName: definition.itemName,
    requestBatch: ({ itemCount, acceptedItems }) => definition.requestBatch({
      anthropicClient,
      chapter,
      chapterName,
      manualChapters,
      existingNormalizedTexts,
      humanItems: sortedHumanItems,
      liveAiItems: sortedLiveAiItems,
      previousAiItems,
      acceptedItems,
      itemCount,
    }),
    validate: (candidate, { acceptedItems }) => definition.validate(candidate, new Set([
      ...existingNormalizedTexts,
      ...acceptedItems.map((acceptedItem) => normalizeForDuplicateCheck(acceptedItem[definition.duplicateCheckFieldName])),
    ])),
  });
}

/**
 * The course glossary terms that no existing flashcard's front matches, compared the way the duplicate check
 * compares them.
 */
function getGlossaryTermsWithoutFlashcard(existingNormalizedFronts) {
  return COURSE_GLOSSARY_TERMS.filter(
    (glossaryTerm) => !existingNormalizedFronts.has(normalizeForDuplicateCheck(glossaryTerm)),
  );
}

/**
 * Returns a copy sorted by the number field (questionNumber or cardNumber).
 */
function sortByItemNumber(items, itemNumberFieldName) {
  return [...items].sort(
    (first, second) => (Number(first[itemNumberFieldName]) || 0) - (Number(second[itemNumberFieldName]) || 0),
  );
}

import { formatJsonLines, formatManualChapterLines, requestClaudeBatch } from "./claudeBatchRequest.js";

// Structured outputs guarantee this shape. Counts and lengths aren't expressible here (no minItems/maxItems/minLength
// support), so flashcardValidation.js checks them.
export const FLASHCARD_BATCH_SCHEMA = {
  type: "object",
  properties: {
    flashcards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          front: { type: "string" },
          back: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          difficulty: { type: "integer", enum: [1, 2, 3] },
        },
        required: ["front", "back", "tags", "difficulty"],
        additionalProperties: false,
      },
    },
  },
  required: ["flashcards"],
  additionalProperties: false,
};

export const FLASHCARD_SYSTEM_PROMPT = `You are an expert writer of study flashcards for the BC real estate licensing course in British Columbia, Canada: the UBC Sauder Real Estate Division's licensing course, under the rules of the BC Financial Services Authority (BCFSA, formerly the Real Estate Council of BC, RECBC).

Every flashcard follows these rules:
- Front: a key term or concept name, in a few words
- Back: a precise, plain-language definition in your own words, 1–3 sentences
- Every definition is accurate under current BC law and practice, including any amounts, time limits, and statutory references
- No trick content: the card teaches the term the way the course and the licensing exam use it
- "difficulty": 1 for a basic term, 2 for a standard term, 3 for a nuanced term
- "tags": lowercase, "definitions" plus 1–3 topic tags like the ones on the example cards
- When you write several flashcards at once, each one is for a different term or concept`;

/**
 * Asks Claude for flashcardCount new flashcards for one chapter, in one request (see requestClaudeBatch).
 * glossaryTermsWithoutFlashcard are the course glossary terms that no flashcard in any chapter covers yet; the prompt
 * offers only those, and leaves the glossary out when there are none.
 *
 * @return {Promise<{items: object[], model: string|null, inputTokens: number, outputTokens: number,
 *   error: string|null}>} items are unvalidated flashcard candidates
 */
export async function requestFlashcardBatch({
  anthropicClient,
  chapter,
  chapterName,
  manualChapters = [],
  glossaryTermsWithoutFlashcard,
  humanFlashcards,
  liveAiFlashcards,
  previousAiFlashcards,
  acceptedFlashcards,
  flashcardCount,
}) {
  return requestClaudeBatch({
    anthropicClient,
    systemPrompt: FLASHCARD_SYSTEM_PROMPT,
    batchSchema: FLASHCARD_BATCH_SCHEMA,
    itemsPropertyName: "flashcards",
    chapterContextText: buildChapterContextText({
      chapter,
      chapterName,
      manualChapters,
      glossaryTermsWithoutFlashcard,
      humanFlashcards,
      liveAiFlashcards,
      previousAiFlashcards,
    }),
    instructionText: buildInstructionText({
      chapter,
      flashcardCount,
      acceptedFlashcards,
      hasManualTopics: manualChapters.length > 0,
      hasGlossaryTerms: glossaryTermsWithoutFlashcard.length > 0,
    }),
  });
}

/**
 * The cached first block: the chapter, its course manual topics, the course glossary terms no card covers yet, its
 * human flashcards as the style reference, and the fronts of every earlier AI flashcard whose term must not be
 * repeated.
 */
function buildChapterContextText({
  chapter,
  chapterName,
  manualChapters,
  glossaryTermsWithoutFlashcard,
  humanFlashcards,
  liveAiFlashcards,
  previousAiFlashcards,
}) {
  return [
    `Chapter ${chapter}: ${chapterName}`,
    "",
    ...formatManualChapterLines(manualChapters, {
      topicsRequirement: "Every flashcard must be for a term or concept from these topics.",
    }),
    ...formatGlossaryTermLines(glossaryTermsWithoutFlashcard),
    `HUMAN-WRITTEN FLASHCARDS (${humanFlashcards.length}): your reference for style, length, difficulty, and tags. ` +
      "Do not reproduce any of them.",
    formatJsonLines(humanFlashcards, ["front", "back", "tags", "difficulty"]),
    "",
    `PUBLISHED AI-GENERATED FLASHCARDS (${liveAiFlashcards.length}): already live for students. ` +
      "Do not make another card for any of these terms.",
    formatJsonLines(liveAiFlashcards, ["front"]),
    "",
    `EARLIER AI-GENERATED FLASHCARDS (${previousAiFlashcards.length}): generated before and then approved, rejected, ` +
      "or still waiting for review. Do not make another card for any of these terms.",
    formatJsonLines(previousAiFlashcards, ["front"]),
  ].join("\n");
}

/**
 * The course glossary terms no card covers yet, then a blank line. No lines when every glossary term has a card.
 */
function formatGlossaryTermLines(glossaryTermsWithoutFlashcard) {
  if (glossaryTermsWithoutFlashcard.length === 0) return [];
  return [
    `COURSE GLOSSARY TERMS (${glossaryTermsWithoutFlashcard.length}): the terms defined in the course manual's ` +
      "glossary, which covers every chapter, that no flashcard in any chapter covers yet (the manual's definitions " +
      "are not included). Make cards for terms from this list first, choosing ones that belong to this chapter's " +
      "topics.",
    glossaryTermsWithoutFlashcard.join("; "),
    "",
  ];
}

/**
 * The second block: what to write. On retries it lists the flashcards this run already accepted.
 */
function buildInstructionText({ chapter, flashcardCount, acceptedFlashcards, hasManualTopics, hasGlossaryTerms }) {
  const lines = [
    `Write exactly ${flashcardCount} new ${flashcardCount === 1 ? "flashcard" : "flashcards"} for Chapter ${chapter}.`,
    "",
    "Requirements for each flashcard:",
    ...(hasManualTopics ? ["- It is for a term or concept from the course manual topics listed for this chapter"] : []),
    ...(hasGlossaryTerms ? ["- Prefer a course glossary term that belongs to this chapter and that no card above covers"] : []),
    "- It is for a term or concept that no card above covers, and that no other flashcard you write now covers",
    "- It matches the style and length of the human-written flashcards: a short term on the front, " +
      "a definition of 1–3 sentences on the back",
    "- \"tags\" are lowercase: \"definitions\" plus 1–3 topic tags",
    "- \"difficulty\" is 1 (basic term), 2 (standard), or 3 (nuanced)",
  ];
  if (acceptedFlashcards.length > 0) {
    lines.push(
      "",
      "Already written for this chapter in this run. Don't make another card for these terms:",
      formatJsonLines(acceptedFlashcards, ["front"]),
    );
  }
  return lines.join("\n");
}

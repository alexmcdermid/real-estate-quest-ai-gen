import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CONTENT_TYPES, generateValidItems, getContentTypeDefinition } from "../src/contentTypes.js";
import { FLASHCARD_BATCH_SCHEMA, FLASHCARD_SYSTEM_PROMPT } from "../src/generateFlashcards.js";
import { QUESTION_BATCH_SCHEMA, QUESTION_SYSTEM_PROMPT } from "../src/generateQuestions.js";
import { COURSE_GLOSSARY_TERMS } from "../src/glossaryTerms.js";
import { createFakeAnthropicClient, createJsonMessage } from "./support/fakeAnthropicClient.js";

/**
 * A valid generated flashcard for the given front.
 */
function createFlashcard(front) {
  return { front, back: `The definition of ${front}.`, tags: ["definitions", "agency law"], difficulty: 2 };
}

/**
 * The glossary terms the flashcard prompt offers, read from its cached block: {count, terms}, or null without a
 * glossary block.
 */
function readOfferedGlossaryTerms(contextText) {
  const glossaryMatch = /COURSE GLOSSARY TERMS \((\d+)\): [^\n]*\n([^\n]*)\n/.exec(contextText);
  return glossaryMatch ? { count: Number(glossaryMatch[1]), terms: glossaryMatch[2].split("; ") } : null;
}

/**
 * A valid generated question whose text includes `label`.
 */
function createQuestion(label) {
  return {
    question: `Question ${label}: which statement is TRUE?`,
    choices: ["First", "Second", "Third", "Fourth"],
    correctChoice: 0,
    explanation: "Correct Answer: 1\n\nBecause.",
  };
}

describe("content types", () => {
  test("are questions and flashcards, each with its own setting and collections", () => {
    assert.deepEqual(CONTENT_TYPES, ["questions", "flashcards"]);
    const namesOf = (contentType) => {
      const { requestBatch, validate, ...names } = getContentTypeDefinition(contentType);
      assert.equal(typeof requestBatch, "function");
      assert.equal(typeof validate, "function");
      return names;
    };
    assert.deepEqual(namesOf("questions"), {
      itemName: "question",
      perRunSettingName: "questionsPerRun",
      humanCollectionName: "questions",
      liveAiCollectionName: "questionsAi",
      pendingCollectionName: "questionsAiPending",
      itemNumberFieldName: "questionNumber",
      duplicateCheckFieldName: "question",
      duplicateCheckCoversEveryChapter: false,
    });
    assert.deepEqual(namesOf("flashcards"), {
      itemName: "flashcard",
      perRunSettingName: "flashcardsPerRun",
      humanCollectionName: "flashcards",
      liveAiCollectionName: "flashcardsAi",
      pendingCollectionName: "flashcardsAiPending",
      itemNumberFieldName: "cardNumber",
      duplicateCheckFieldName: "front",
      duplicateCheckCoversEveryChapter: true,
    });
  });

  test("throw for an unknown content type", () => {
    for (const contentType of ["answers", "toString", undefined]) {
      assert.throws(
        () => getContentTypeDefinition(contentType),
        new RegExp(`^Error: contentType must be one of: questions, flashcards, got ${contentType}$`),
        String(contentType),
      );
    }
  });

  test("validate returns the validated item, or the errors", () => {
    const { validate } = getContentTypeDefinition("flashcards");
    assert.deepEqual(validate({ ...createFlashcard("Agency"), front: " Agency ", tags: ["Definitions"] }, new Set()), {
      valid: true,
      item: { ...createFlashcard("Agency"), tags: ["definitions"] },
    });
    assert.deepEqual(validate(createFlashcard("Agency"), new Set(["agency"])), {
      valid: false,
      errors: ["Front duplicates an existing flashcard"],
    });
  });
});

describe("generateValidItems", () => {
  test("flashcards: lists the context in card order and rejects fronts from the context and from the run", async () => {
    const { client, requests } = createFakeAnthropicClient([
      createJsonMessage({ flashcards: [createFlashcard("FIDUCIARY"), createFlashcard("Dual Agency"), createFlashcard("dual agency")] }),
      createJsonMessage({ flashcards: [createFlashcard("  negligence "), createFlashcard("Deceit"), createFlashcard("Remuneration")] }),
    ]);
    const collected = await generateValidItems({
      contentType: "flashcards",
      anthropicClient: client,
      chapter: 3,
      humanItems: [
        { cardNumber: 2, front: "Fiduciary", back: "Second human card", tags: ["definitions"], difficulty: 1 },
        { cardNumber: 1, front: "Deceit", back: "First human card", tags: ["definitions"], difficulty: 2 },
      ],
      liveAiItems: [],
      previousAiItems: [{ front: "Negligence", status: "rejected" }],
      everyChapterItems: [],
      requestedItemCount: 3,
    });

    assert.deepEqual(collected.acceptedItems.map((flashcard) => flashcard.front), ["Dual Agency", "Remuneration"]);
    assert.deepEqual(collected.errors, [
      "attempt 1: flashcard 1: Front duplicates an existing flashcard",
      "attempt 1: flashcard 3: Front duplicates an existing flashcard",
      "attempt 2: flashcard 1: Front duplicates an existing flashcard",
      "attempt 2: flashcard 2: Front duplicates an existing flashcard",
      "attempt 3: request failed: No queued message for request 3",
    ]);

    assert.equal(requests.length, 3);
    const [firstRequest, retryRequest] = requests;
    assert.equal(firstRequest.system, FLASHCARD_SYSTEM_PROMPT);
    assert.equal(firstRequest.output_config.format.schema, FLASHCARD_BATCH_SCHEMA);
    const [contextBlock, instructionBlock] = firstRequest.messages[0].content;
    assert.match(contextBlock.text, /^Chapter 3: The Professional Liability of Real Estate Licensees\n/);
    assert.match(contextBlock.text, /Manual chapter 5, The Professional Liability of Real Estate Licensees:\n- Common Grounds/);
    assert.ok(contextBlock.text.indexOf("First human card") < contextBlock.text.indexOf("Second human card"), "by cardNumber");
    assert.match(instructionBlock.text, /^Write exactly 3 new flashcards for Chapter 3\./);
    assert.match(retryRequest.messages[0].content[1].text, /^Write exactly 2 new flashcards for Chapter 3\.[\s\S]*\{"front":"Dual Agency"\}$/);
  });

  test("flashcards: rejects a front that only another chapter's card has, without listing those cards", async () => {
    const { client, requests } = createFakeAnthropicClient([
      createJsonMessage({ flashcards: [
        createFlashcard("assumable  MORTGAGE"),
        createFlashcard("Other Chapter Live AI Term"),
        createFlashcard(" other chapter pending term "),
        createFlashcard("Power of Sale"),
      ] }),
    ]);
    const collected = await generateValidItems({
      contentType: "flashcards",
      anthropicClient: client,
      chapter: 11,
      humanItems: [{ cardNumber: 1, front: "Foreclosure", back: "Chapter 11 human card", tags: ["definitions"], difficulty: 2 }],
      liveAiItems: [],
      previousAiItems: [],
      // As runGeneration reads them: only the fronts of every chapter's human, live AI and generated cards, this
      // chapter's included. The empty one is a card without a front.
      everyChapterItems: [
        { front: "Foreclosure" },
        { front: "Assumable Mortgage" }, // a human card of chapter 9
        { front: "Other Chapter Live AI Term" },
        { front: "Other Chapter Pending Term" },
        {},
      ],
      requestedItemCount: 1,
    });

    assert.deepEqual(collected.acceptedItems.map((flashcard) => flashcard.front), ["Power of Sale"]);
    assert.deepEqual(collected.errors, [1, 2, 3].map(
      (candidateNumber) => `attempt 1: flashcard ${candidateNumber}: Front duplicates an existing flashcard`,
    ));
    assert.equal(requests.length, 1);
    const [contextBlock] = requests[0].messages[0].content;
    assert.match(contextBlock.text, /HUMAN-WRITTEN FLASHCARDS \(1\): .*\n\{"front":"Foreclosure",/);
    assert.match(contextBlock.text, /PUBLISHED AI-GENERATED FLASHCARDS \(0\): .*\n\(none\)\n/);
    assert.match(contextBlock.text, /EARLIER AI-GENERATED FLASHCARDS \(0\): .*\n\(none\)$/);
    for (const otherChapterFront of ["Assumable Mortgage", "Other Chapter Live AI Term", "Other Chapter Pending Term"]) {
      assert.equal(contextBlock.text.includes(otherChapterFront), false, `${otherChapterFront} is not in the prompt`);
    }
  });

  test("flashcards: the prompt offers only the glossary terms no card in any chapter covers, on every attempt", async () => {
    const { client, requests } = createFakeAnthropicClient([
      createJsonMessage({ flashcards: [createFlashcard("Accrual Basis")] }),
      createJsonMessage({ flashcards: [createFlashcard("Airspace")] }),
    ]);
    const collected = await generateValidItems({
      contentType: "flashcards",
      anthropicClient: client,
      chapter: 11,
      humanItems: [],
      liveAiItems: [],
      previousAiItems: [],
      everyChapterItems: [{ front: " assumable   MORTGAGE " }, { front: "Vicarious Liability" }, { front: "Not A Glossary Term" }],
      requestedItemCount: 2,
    });
    assert.deepEqual(collected.acceptedItems.map((flashcard) => flashcard.front), ["Accrual Basis", "Airspace"]);

    const expectedGlossaryTerms = COURSE_GLOSSARY_TERMS.filter(
      (glossaryTerm) => !["Assumable Mortgage", "Vicarious Liability"].includes(glossaryTerm),
    );
    assert.equal(expectedGlossaryTerms.length, COURSE_GLOSSARY_TERMS.length - 2);
    assert.equal(requests.length, 2);
    const [firstContextBlock, firstInstructionBlock] = requests[0].messages[0].content;
    assert.deepEqual(readOfferedGlossaryTerms(firstContextBlock.text), {
      count: expectedGlossaryTerms.length,
      terms: expectedGlossaryTerms,
    });
    assert.match(firstInstructionBlock.text, /Prefer a course glossary term that belongs to this chapter/);
    // The card accepted on attempt 1 stays in the list, so the cached block is the same on the retry.
    assert.equal(requests[1].messages[0].content[0].text, firstContextBlock.text);
  });

  test("flashcards: leaves the glossary out of the prompt when every glossary term has a card", async () => {
    const { client, requests } = createFakeAnthropicClient([
      createJsonMessage({ flashcards: [createFlashcard("Power of Sale")] }),
    ]);
    await generateValidItems({
      contentType: "flashcards",
      anthropicClient: client,
      chapter: 11,
      humanItems: [],
      liveAiItems: [],
      previousAiItems: [],
      everyChapterItems: COURSE_GLOSSARY_TERMS.map((glossaryTerm) => ({ front: glossaryTerm.toUpperCase() })),
      requestedItemCount: 1,
    });
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;
    assert.equal(readOfferedGlossaryTerms(contextBlock.text), null);
    assert.equal(contextBlock.text.includes("GLOSSARY"), false);
    assert.equal(instructionBlock.text.toLowerCase().includes("glossary"), false);
  });

  test("flashcards: every chapter's items are required", () => {
    assert.throws(() => generateValidItems({
      contentType: "flashcards",
      anthropicClient: createFakeAnthropicClient([]).client,
      chapter: 11,
      humanItems: [],
      liveAiItems: [],
      previousAiItems: [],
      requestedItemCount: 1,
    }), /^Error: everyChapterItems must be an array for flashcards, got undefined$/);
  });

  test("questions: sends the question request and rejects a repeat of a published AI question", async () => {
    const { client, requests } = createFakeAnthropicClient([
      createJsonMessage({ questions: [createQuestion("live"), createQuestion("new")] }),
    ]);
    const collected = await generateValidItems({
      contentType: "questions",
      anthropicClient: client,
      chapter: 8,
      humanItems: [
        { questionNumber: 2, question: "Second human question?", choices: ["a", "b", "c", "d"], correctChoice: 0, explanation: "x" },
        { questionNumber: 1, question: "First human question?", choices: ["a", "b", "c", "d"], correctChoice: 0, explanation: "x" },
      ],
      liveAiItems: [{ questionNumber: 1, ...createQuestion("LIVE") }],
      previousAiItems: [],
      requestedItemCount: 1,
    });

    assert.deepEqual(collected.acceptedItems, [{ ...createQuestion("new"), model: "claude-opus-5-5" }]);
    assert.deepEqual(collected.errors, ["attempt 1: question 1: Question duplicates an existing question"]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].system, QUESTION_SYSTEM_PROMPT);
    assert.equal(requests[0].output_config.format.schema, QUESTION_BATCH_SCHEMA);
    const [contextBlock] = requests[0].messages[0].content;
    assert.match(contextBlock.text, /^Chapter 8: Contracts for Real Estate Transactions and Law of Agency\n/);
    assert.ok(contextBlock.text.indexOf("First human question?") < contextBlock.text.indexOf("Second human question?"));
  });
});

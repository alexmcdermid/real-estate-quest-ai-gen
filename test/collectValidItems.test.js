import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { collectValidItems } from "../src/collectValidItems.js";
import { getContentTypeDefinition } from "../src/contentTypes.js";
import { normalizeForDuplicateCheck } from "../src/textChecks.js";

/**
 * A valid generated question whose text includes `label`.
 */
function createQuestion(label) {
  return {
    question: `Question ${label}: which statement about the Real Estate Services Act is TRUE?`,
    choices: ["First", "Second", "Third", "Fourth"],
    correctChoice: 1,
    explanation: `Correct Answer: 2\n\nExplanation for ${label}.`,
  };
}

/**
 * A batch result, as requestClaudeBatch returns it.
 */
function createBatch(items, { error = null, model = "claude-opus-5-5", inputTokens = 1000, outputTokens = 500 } = {}) {
  return { items, model, inputTokens, outputTokens, error };
}

/**
 * A requestBatch that returns the given results (or throws the given errors) in order and records its calls.
 */
function createRequestBatch(results) {
  const calls = [];
  const requestBatch = async (request) => {
    calls.push(request);
    const result = results[calls.length - 1];
    if (result instanceof Error) throw result;
    return result;
  };
  return { requestBatch, calls };
}

/**
 * The validator generateValidItems builds: the content type's rules plus a duplicate check against the context and the
 * accepted items.
 */
function createValidate(contentType, contextTexts = []) {
  const definition = getContentTypeDefinition(contentType);
  return (candidate, { acceptedItems }) => definition.validate(candidate, new Set([
    ...contextTexts.map(normalizeForDuplicateCheck),
    ...acceptedItems.map((acceptedItem) => normalizeForDuplicateCheck(acceptedItem[definition.duplicateCheckFieldName])),
  ]));
}

/**
 * Runs collectValidItems for questions with 3 attempts.
 */
function collectQuestions({ requestedItemCount, requestBatch, validate = createValidate("questions") }) {
  return collectValidItems({ requestedItemCount, itemName: "question", maxAttempts: 3, requestBatch, validate });
}

/**
 * The question texts, for comparing lists of questions.
 */
function questionTexts(questions) {
  return questions.map((question) => question.question);
}

describe("collectValidItems", () => {
  test("stops once the requested count is complete", async () => {
    const { requestBatch, calls } = createRequestBatch([createBatch([createQuestion("a"), createQuestion("b")])]);
    const collected = await collectQuestions({ requestedItemCount: 2, requestBatch });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { itemCount: 2, acceptedItems: [] });
    assert.deepEqual(collected, {
      acceptedItems: [
        { ...createQuestion("a"), model: "claude-opus-5-5" },
        { ...createQuestion("b"), model: "claude-opus-5-5" },
      ],
      errors: [],
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
  });

  test("retries for the remaining count and passes the accepted items into later attempts", async () => {
    const invalidQuestion = { ...createQuestion("bad"), explanation: "Correct Answer: 4\n\nWrong prefix." };
    const { requestBatch, calls } = createRequestBatch([
      createBatch([createQuestion("a"), invalidQuestion, createQuestion("b")]),
      createBatch([createQuestion("c")], { model: "claude-opus-5" }),
      createBatch([createQuestion("d")]),
    ]);
    const collected = await collectQuestions({ requestedItemCount: 4, requestBatch });

    assert.deepEqual(calls.map((call) => call.itemCount), [4, 2, 1]);
    assert.deepEqual(questionTexts(calls[1].acceptedItems), questionTexts(["a", "b"].map(createQuestion)));
    assert.deepEqual(questionTexts(calls[2].acceptedItems), questionTexts(["a", "b", "c"].map(createQuestion)));

    assert.deepEqual(questionTexts(collected.acceptedItems), questionTexts(["a", "b", "c", "d"].map(createQuestion)));
    assert.deepEqual(collected.acceptedItems.map((question) => question.model), [
      "claude-opus-5-5",
      "claude-opus-5-5",
      "claude-opus-5",
      "claude-opus-5-5",
    ]);
    assert.equal(collected.model, "claude-opus-5-5");
    assert.equal(collected.inputTokens, 3000);
    assert.equal(collected.outputTokens, 1500);
    assert.deepEqual(collected.errors, [
      "attempt 1: received 3 of 4 requested questions",
      "attempt 1: question 2: Explanation must start with \"Correct Answer: 2\"",
      "attempt 2: received 1 of 2 requested questions",
    ]);
  });

  test("records validation, response and request errors per attempt, and stops after maxAttempts", async () => {
    const { requestBatch, calls } = createRequestBatch([
      new Error("529 overloaded_error"),
      createBatch([], { error: "Claude declined the request (category: none)" }),
      createBatch([{ ...createQuestion("dup") }, { ...createQuestion("x"), choices: ["A", "a", "B", "C"] }]),
    ]);
    const collected = await collectQuestions({
      requestedItemCount: 2,
      requestBatch,
      validate: createValidate("questions", [createQuestion("dup").question]),
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.itemCount), [2, 2, 2]);
    assert.deepEqual(collected.acceptedItems, []);
    assert.deepEqual(collected.errors, [
      "attempt 1: request failed: 529 overloaded_error",
      "attempt 2: Claude declined the request (category: none)",
      "attempt 3: question 1: Question duplicates an existing question",
      "attempt 3: question 2: Choices must all be different",
    ]);
    assert.equal(collected.inputTokens, 2000);
  });

  test("never accepts more than the requested count", async () => {
    const { requestBatch } = createRequestBatch([
      createBatch(["a", "b", "c", "d", "e"].map(createQuestion)),
    ]);
    const collected = await collectQuestions({ requestedItemCount: 2, requestBatch });
    assert.equal(collected.acceptedItems.length, 2);
    assert.deepEqual(collected.errors, []);
  });

  test("rejects an item repeated within the same batch", async () => {
    const { requestBatch } = createRequestBatch([
      createBatch([createQuestion("a"), createQuestion("a")]),
      createBatch([createQuestion("b")]),
    ]);
    const collected = await collectQuestions({ requestedItemCount: 2, requestBatch });
    assert.deepEqual(questionTexts(collected.acceptedItems), questionTexts(["a", "b"].map(createQuestion)));
    assert.deepEqual(collected.errors, ["attempt 1: question 2: Question duplicates an existing question"]);
  });

  test("names flashcards in the errors and keeps the normalized flashcard values", async () => {
    const flashcard = { front: " Dual Agency ", back: "One licensee acting for both parties.", tags: ["Definitions", "agency law"], difficulty: 2 };
    const { requestBatch } = createRequestBatch([
      createBatch([flashcard, { ...flashcard, front: "dual   agency" }]),
      createBatch([]),
      createBatch([{ ...flashcard, front: "Agency", difficulty: 4 }]),
    ]);
    const collected = await collectValidItems({
      requestedItemCount: 2,
      itemName: "flashcard",
      maxAttempts: 3,
      requestBatch,
      validate: createValidate("flashcards"),
    });

    assert.deepEqual(collected.acceptedItems, [{
      front: "Dual Agency",
      back: "One licensee acting for both parties.",
      tags: ["definitions", "agency law"],
      difficulty: 2,
      model: "claude-opus-5-5",
    }]);
    assert.deepEqual(collected.errors, [
      "attempt 1: flashcard 2: Front duplicates an existing flashcard",
      "attempt 2: received 0 of 1 requested flashcards",
      "attempt 3: flashcard 1: Difficulty must be an integer from 1 to 3",
    ]);
  });
});

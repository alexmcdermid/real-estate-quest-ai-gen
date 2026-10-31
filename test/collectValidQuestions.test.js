import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeQuestionText, validateGeneratedQuestion } from "../src/questionValidation.js";
import { collectValidQuestions } from "../src/collectValidQuestions.js";

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
 * A question batch result, as requestQuestionBatch returns it.
 */
function createBatch(questions, { error = null, model = "claude-opus-5-5", inputTokens = 1000, outputTokens = 500 } = {}) {
  return { questions, model, inputTokens, outputTokens, error };
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
 * The validator runGeneration uses: rules plus a duplicate check against the context and the accepted questions.
 */
function createValidate(contextQuestionTexts = []) {
  return (candidate, { acceptedQuestions }) => validateGeneratedQuestion(candidate, {
    existingQuestionTexts: new Set([
      ...contextQuestionTexts.map(normalizeQuestionText),
      ...acceptedQuestions.map((acceptedQuestion) => normalizeQuestionText(acceptedQuestion.question)),
    ]),
  });
}

/**
 * Runs collectValidQuestions with 3 attempts.
 */
function collect({ requestedQuestionCount, requestBatch, validate = createValidate() }) {
  return collectValidQuestions({ requestedQuestionCount, maxAttempts: 3, requestBatch, validate });
}

/**
 * The question texts, for comparing lists of questions.
 */
function questionTexts(questions) {
  return questions.map((question) => question.question);
}

describe("collectValidQuestions", () => {
  test("stops once the requested count is complete", async () => {
    const { requestBatch, calls } = createRequestBatch([createBatch([createQuestion("a"), createQuestion("b")])]);
    const collected = await collect({ requestedQuestionCount: 2, requestBatch });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { questionCount: 2, acceptedQuestions: [] });
    assert.deepEqual(collected, {
      acceptedQuestions: [
        { ...createQuestion("a"), model: "claude-opus-5-5" },
        { ...createQuestion("b"), model: "claude-opus-5-5" },
      ],
      errors: [],
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
  });

  test("retries for the remaining count and passes the accepted questions into later attempts", async () => {
    const invalidQuestion = { ...createQuestion("bad"), explanation: "Correct Answer: 4\n\nWrong prefix." };
    const { requestBatch, calls } = createRequestBatch([
      createBatch([createQuestion("a"), invalidQuestion, createQuestion("b")]),
      createBatch([createQuestion("c")], { model: "claude-opus-5" }),
      createBatch([createQuestion("d")]),
    ]);
    const collected = await collect({ requestedQuestionCount: 4, requestBatch });

    assert.deepEqual(calls.map((call) => call.questionCount), [4, 2, 1]);
    assert.deepEqual(questionTexts(calls[1].acceptedQuestions), questionTexts(["a", "b"].map(createQuestion)));
    assert.deepEqual(questionTexts(calls[2].acceptedQuestions), questionTexts(["a", "b", "c"].map(createQuestion)));

    assert.deepEqual(questionTexts(collected.acceptedQuestions), questionTexts(["a", "b", "c", "d"].map(createQuestion)));
    assert.deepEqual(collected.acceptedQuestions.map((question) => question.model), [
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
    const collected = await collect({
      requestedQuestionCount: 2,
      requestBatch,
      validate: createValidate([createQuestion("dup").question]),
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.questionCount), [2, 2, 2]);
    assert.deepEqual(collected.acceptedQuestions, []);
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
    const collected = await collect({ requestedQuestionCount: 2, requestBatch });
    assert.equal(collected.acceptedQuestions.length, 2);
    assert.deepEqual(collected.errors, []);
  });

  test("rejects a question repeated within the same batch", async () => {
    const { requestBatch } = createRequestBatch([
      createBatch([createQuestion("a"), createQuestion("a")]),
      createBatch([createQuestion("b")]),
    ]);
    const collected = await collect({ requestedQuestionCount: 2, requestBatch });
    assert.deepEqual(questionTexts(collected.acceptedQuestions), questionTexts(["a", "b"].map(createQuestion)));
    assert.deepEqual(collected.errors, ["attempt 1: question 2: Question duplicates an existing question"]);
  });
});

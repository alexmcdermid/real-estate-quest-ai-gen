import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidQuestionCount, normalizeAiSettings } from "../src/aiSettings.js";

describe("normalizeAiSettings", () => {
  test("defaults everything off with one question per run when the document is missing", () => {
    const defaults = { generationEnabled: false, servingEnabled: false, questionsPerRun: 1 };
    assert.deepEqual(normalizeAiSettings(undefined), defaults);
    assert.deepEqual(normalizeAiSettings({}), defaults);
  });

  test("only treats true as on", () => {
    assert.deepEqual(normalizeAiSettings({ generationEnabled: true, servingEnabled: "true", questionsPerRun: 3 }), {
      generationEnabled: true,
      servingEnabled: false,
      questionsPerRun: 3,
    });
  });

  test("clamps questionsPerRun to an integer from 1 to 10", () => {
    assert.equal(normalizeAiSettings({ questionsPerRun: 0 }).questionsPerRun, 1);
    assert.equal(normalizeAiSettings({ questionsPerRun: -4 }).questionsPerRun, 1);
    assert.equal(normalizeAiSettings({ questionsPerRun: 25 }).questionsPerRun, 10);
    assert.equal(normalizeAiSettings({ questionsPerRun: 2.7 }).questionsPerRun, 2);
    assert.equal(normalizeAiSettings({ questionsPerRun: "5" }).questionsPerRun, 5);
    assert.equal(normalizeAiSettings({ questionsPerRun: "many" }).questionsPerRun, 1);
    assert.equal(normalizeAiSettings({ questionsPerRun: Number.NaN }).questionsPerRun, 1);
  });
});

describe("isValidQuestionCount", () => {
  test("accepts integers from 1 to 10 only", () => {
    assert.deepEqual([1, 10].map(isValidQuestionCount), [true, true]);
    assert.deepEqual([0, 11, 2.5, "3", null].map(isValidQuestionCount), [false, false, false, false, false]);
  });
});

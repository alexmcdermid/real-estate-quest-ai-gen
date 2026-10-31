import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isValidItemCount, normalizeAiSettings } from "../src/aiSettings.js";

describe("normalizeAiSettings", () => {
  test("defaults everything off with one question and one flashcard per run when the document is missing", () => {
    const defaults = { generationEnabled: false, servingEnabled: false, questionsPerRun: 1, flashcardsPerRun: 1 };
    assert.deepEqual(normalizeAiSettings(undefined), defaults);
    assert.deepEqual(normalizeAiSettings({}), defaults);
  });

  test("only treats true as on", () => {
    const settings = normalizeAiSettings({ generationEnabled: true, servingEnabled: "true", questionsPerRun: 3, flashcardsPerRun: 4 });
    assert.deepEqual(settings, { generationEnabled: true, servingEnabled: false, questionsPerRun: 3, flashcardsPerRun: 4 });
  });

  test("clamps questionsPerRun and flashcardsPerRun to integers from 1 to 10, independently", () => {
    for (const perRunSettingName of ["questionsPerRun", "flashcardsPerRun"]) {
      const clamp = (value) => normalizeAiSettings({ [perRunSettingName]: value })[perRunSettingName];
      assert.deepEqual([0, -4, 25, 2.7, "5", "many", Number.NaN, null].map(clamp), [1, 1, 10, 2, 5, 1, 1, 1], perRunSettingName);
    }
    assert.deepEqual(normalizeAiSettings({ questionsPerRun: 7 }), {
      generationEnabled: false,
      servingEnabled: false,
      questionsPerRun: 7,
      flashcardsPerRun: 1,
    });
  });
});

describe("isValidItemCount", () => {
  test("accepts integers from 1 to 10 only", () => {
    assert.deepEqual([1, 10].map(isValidItemCount), [true, true]);
    assert.deepEqual([0, 11, 2.5, "3", null].map(isValidItemCount), [false, false, false, false, false]);
  });
});

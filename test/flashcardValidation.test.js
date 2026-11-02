import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateGeneratedFlashcard } from "../src/flashcardValidation.js";
import { normalizeForDuplicateCheck } from "../src/textChecks.js";

const validCandidate = {
  front: "Dual Agency",
  back: "A situation where one licensee or brokerage represents both the buyer and the seller in the same transaction.",
  tags: ["definitions", "agency law"],
  difficulty: 2,
};
const noExistingFronts = { existingFronts: new Set() };

/**
 * Returns the validation errors for validCandidate with the given fields replaced.
 */
function errorsFor(overrides, options = noExistingFronts) {
  const result = validateGeneratedFlashcard({ ...validCandidate, ...overrides }, options);
  assert.equal(result.valid, false);
  return result.errors;
}

describe("validateGeneratedFlashcard", () => {
  test("accepts a valid flashcard", () => {
    assert.deepEqual(validateGeneratedFlashcard(validCandidate, noExistingFronts), {
      valid: true,
      flashcard: validCandidate,
    });
  });

  test("returns trimmed values, and tags lowercased with duplicates removed", () => {
    const result = validateGeneratedFlashcard({
      front: `  ${validCandidate.front}\n`,
      back: `\n${validCandidate.back}  `,
      tags: [" Definitions ", "AGENCY LAW", "definitions", "agency law "],
      difficulty: 2,
    }, noExistingFronts);
    assert.deepEqual(result, { valid: true, flashcard: validCandidate });
  });

  test("rejects a non-object candidate", () => {
    assert.deepEqual(validateGeneratedFlashcard(null, noExistingFronts), {
      valid: false,
      errors: ["Flashcard must be an object"],
    });
    assert.equal(validateGeneratedFlashcard(["a"], noExistingFronts).valid, false);
  });

  test("rejects an empty or non-text front or back", () => {
    assert.deepEqual(errorsFor({ front: "   " }), ["Front must be non-empty text"]);
    assert.deepEqual(errorsFor({ front: 42 }), ["Front must be non-empty text"]);
    assert.deepEqual(errorsFor({ back: "" }), ["Back must be non-empty text"]);
    assert.deepEqual(errorsFor({ back: ["A definition"] }), ["Back must be non-empty text"]);
  });

  test("enforces the length caps on the front and the back", () => {
    assert.deepEqual(errorsFor({ front: "f".repeat(101) }), ["Front must be at most 100 characters"]);
    assert.deepEqual(errorsFor({ back: "b".repeat(601) }), ["Back must be at most 600 characters"]);
    assert.equal(validateGeneratedFlashcard({ ...validCandidate, front: "f".repeat(100), back: "b".repeat(600) },
      noExistingFronts).valid, true);
  });

  test("requires 1 to 5 different tags, counted after normalizing", () => {
    const tagCountErrors = ["There must be 1 to 5 different tags"];
    assert.deepEqual(errorsFor({ tags: [] }), tagCountErrors);
    assert.deepEqual(errorsFor({ tags: "definitions, agency law" }), tagCountErrors);
    assert.deepEqual(errorsFor({ tags: undefined }), tagCountErrors);
    assert.deepEqual(errorsFor({ tags: ["a", "b", "c", "d", "e", "f"] }), tagCountErrors);
    const sixTagsWithOneRepeated = ["definitions", "a", "b", "c", "d", "Definitions"];
    assert.deepEqual(validateGeneratedFlashcard({ ...validCandidate, tags: sixTagsWithOneRepeated }, noExistingFronts)
      .flashcard.tags, ["definitions", "a", "b", "c", "d"]);
  });

  test("rejects empty, non-text and too long tags", () => {
    assert.deepEqual(errorsFor({ tags: ["definitions", " ", 7, "t".repeat(41)] }), [
      "Tag 2 must be non-empty text",
      "Tag 3 must be non-empty text",
      "Tag 4 must be at most 40 characters",
    ]);
    assert.equal(validateGeneratedFlashcard({ ...validCandidate, tags: ["t".repeat(40)] }, noExistingFronts).valid, true);
  });

  test("rejects a difficulty that is out of range or not an integer", () => {
    for (const difficulty of [0, 4, 1.5, "2", null, undefined]) {
      assert.deepEqual(errorsFor({ difficulty }), ["Difficulty must be an integer from 1 to 3"], `difficulty ${difficulty}`);
    }
    for (const difficulty of [1, 2, 3]) {
      assert.equal(validateGeneratedFlashcard({ ...validCandidate, difficulty }, noExistingFronts).valid, true);
    }
  });

  test("rejects a front that duplicates an existing flashcard, ignoring case and whitespace", () => {
    const existingFronts = new Set([normalizeForDuplicateCheck(validCandidate.front)]);
    assert.deepEqual(errorsFor({ front: "  DUAL    agency " }, { existingFronts }), ["Front duplicates an existing flashcard"]);
    assert.equal(validateGeneratedFlashcard({ ...validCandidate, front: "Designated Agency" }, { existingFronts }).valid, true);
  });

  test("rejects ChatGPT citation artifacts in the front or the back", () => {
    const citationArtifactErrors = [
      'Front and back must not contain "contentReference[oaicite" (a ChatGPT citation artifact)',
    ];
    const citationArtifact = "&#8203;:contentReference[oaicite:0]{index=0}";
    assert.deepEqual(errorsFor({ front: `Agency${citationArtifact}` }), citationArtifactErrors);
    assert.deepEqual(errorsFor({ back: `${validCandidate.back}:contentReference[oaicite:3]{index=3}` }), citationArtifactErrors);
  });

  test("reports every problem at once", () => {
    const result = validateGeneratedFlashcard({ front: "", back: "", tags: [], difficulty: 9 }, noExistingFronts);
    assert.deepEqual(result.errors, [
      "Front must be non-empty text",
      "Back must be non-empty text",
      "There must be 1 to 5 different tags",
      "Difficulty must be an integer from 1 to 3",
    ]);
  });
});

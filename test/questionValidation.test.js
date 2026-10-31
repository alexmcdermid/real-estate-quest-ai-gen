import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeQuestionText, removeCitationArtifacts, validateGeneratedQuestion } from "../src/questionValidation.js";

const validCandidate = {
  question: "Which of the following best describes a licensee's duty of loyalty to a client?",
  choices: [
    "Act in the client's best interests",
    "Disclose all client information to the other party",
    "Follow any instruction",
    "Avoid all conflicts",
  ],
  correctChoice: 0,
  explanation: "Correct Answer: 1\n\nA licensee must act in the client's best interests.",
};
const noExistingQuestions = { existingQuestionTexts: new Set() };

/**
 * Returns the validation errors for validCandidate with the given fields replaced.
 */
function errorsFor(overrides, options = noExistingQuestions) {
  const result = validateGeneratedQuestion({ ...validCandidate, ...overrides }, options);
  assert.equal(result.valid, false);
  return result.errors;
}

describe("validateGeneratedQuestion", () => {
  test("accepts a valid question", () => {
    assert.deepEqual(validateGeneratedQuestion(validCandidate, noExistingQuestions), {
      valid: true,
      question: validCandidate,
    });
  });

  test("returns trimmed values", () => {
    const result = validateGeneratedQuestion({
      question: `  ${validCandidate.question}\n`,
      choices: validCandidate.choices.map((choice) => ` ${choice} `),
      correctChoice: 0,
      explanation: `\n${validCandidate.explanation}  `,
    }, noExistingQuestions);
    assert.deepEqual(result, { valid: true, question: validCandidate });
  });

  test("rejects a non-object candidate", () => {
    assert.deepEqual(validateGeneratedQuestion(null, noExistingQuestions), {
      valid: false,
      errors: ["Question must be an object"],
    });
    assert.equal(validateGeneratedQuestion(["a"], noExistingQuestions).valid, false);
  });

  test("rejects an empty or whitespace-only question", () => {
    assert.deepEqual(errorsFor({ question: "   " }), ["Question must be non-empty text"]);
    assert.deepEqual(errorsFor({ question: 42 }), ["Question must be non-empty text"]);
  });

  test("rejects a wrong number of choices", () => {
    const wrongChoiceCountErrors = ["There must be exactly 4 choices"];
    assert.deepEqual(errorsFor({ choices: validCandidate.choices.slice(0, 3) }), wrongChoiceCountErrors);
    assert.deepEqual(errorsFor({ choices: [...validCandidate.choices, "Fifth"] }), wrongChoiceCountErrors);
    assert.deepEqual(errorsFor({ choices: "A, B, C, D" }), wrongChoiceCountErrors);
  });

  test("rejects empty or non-string choices", () => {
    assert.deepEqual(errorsFor({ choices: ["A", " ", "C", 4] }), [
      "Choice 2 must be non-empty text",
      "Choice 4 must be non-empty text",
    ]);
  });

  test("rejects duplicate choices, comparing trimmed and case-insensitively", () => {
    assert.deepEqual(errorsFor({ choices: ["Yes", "No", " yes ", "Maybe"] }), ["Choices must all be different"]);
  });

  test("rejects a correctChoice that is out of range or not an integer", () => {
    for (const correctChoice of [-1, 4, 1.5, "0", null, undefined]) {
      const errors = errorsFor({ correctChoice });
      assert.deepEqual(errors, ["Correct choice must be an integer from 0 to 3"], `correctChoice ${correctChoice}`);
    }
  });

  test("rejects an empty explanation", () => {
    assert.deepEqual(errorsFor({ explanation: " " }), ["Explanation must be non-empty text"]);
  });

  test("rejects an explanation whose prefix doesn't match correctChoice", () => {
    assert.deepEqual(errorsFor({ correctChoice: 2 }), ['Explanation must start with "Correct Answer: 3"']);
    assert.deepEqual(errorsFor({ explanation: "The answer is 1 because..." }), [
      'Explanation must start with "Correct Answer: 1"',
    ]);
  });

  test("enforces the length caps", () => {
    assert.deepEqual(errorsFor({ question: "q".repeat(4001) }), ["Question must be at most 4000 characters"]);
    assert.deepEqual(errorsFor({ choices: ["c".repeat(1001), "B", "C", "D"] }), ["Choice 1 must be at most 1000 characters"]);
    assert.deepEqual(errorsFor({ explanation: `Correct Answer: 1\n\n${"e".repeat(8000)}` }), [
      "Explanation must be at most 8000 characters",
    ]);
    assert.deepEqual(errorsFor({ explanation: `Wrong start ${"e".repeat(8000)}` }), [
      "Explanation must be at most 8000 characters",
      'Explanation must start with "Correct Answer: 1"',
    ]);
    assert.equal(validateGeneratedQuestion({ ...validCandidate, question: "q".repeat(4000) }, noExistingQuestions).valid, true);
  });

  test("rejects a duplicate of an existing question, ignoring case and whitespace", () => {
    const existingQuestionTexts = new Set([normalizeQuestionText(validCandidate.question)]);
    const shoutedWithExtraSpaces = `  ${validCandidate.question.toUpperCase().replace(/ /g, "   ")}  `;
    assert.deepEqual(errorsFor({ question: shoutedWithExtraSpaces }, { existingQuestionTexts }), [
      "Question duplicates an existing question",
    ]);
  });

  test("rejects ChatGPT citation artifacts in the question, a choice or the explanation", () => {
    const citationArtifactErrors = [
      'Question, choices and explanation must not contain "contentReference[oaicite" (a ChatGPT citation artifact)',
    ];
    const citationArtifact = "&#8203;:contentReference[oaicite:0]{index=0}";
    assert.deepEqual(errorsFor({ question: `${validCandidate.question}${citationArtifact}` }), citationArtifactErrors);
    assert.deepEqual(errorsFor({ choices: ["A", `B${citationArtifact}`, "C", "D"] }), citationArtifactErrors);
    assert.deepEqual(
      errorsFor({ explanation: `${validCandidate.explanation}:contentReference[oaicite:3]{index=3}` }),
      citationArtifactErrors,
    );
  });

  test("reports every problem at once", () => {
    const emptyCandidate = { question: "", choices: [], correctChoice: 9, explanation: "" };
    const result = validateGeneratedQuestion(emptyCandidate, noExistingQuestions);
    assert.deepEqual(result.errors, [
      "Question must be non-empty text",
      "There must be exactly 4 choices",
      "Correct choice must be an integer from 0 to 3",
      "Explanation must be non-empty text",
    ]);
  });
});

describe("normalizeQuestionText", () => {
  test("lowercases, collapses whitespace and trims", () => {
    assert.equal(normalizeQuestionText("  What IS\n\tthe   Answer?  "), "what is the answer?");
  });
});

describe("removeCitationArtifacts", () => {
  test("removes each artifact with the &#8203; entity, a literal zero-width space, or nothing in front", () => {
    const explanationFromChapter8 = "an unfair result&#8203;:contentReference[oaicite:0]{index=0}" +
      "&#8203;:contentReference[oaicite:1]{index=1}. Therefore";
    assert.equal(removeCitationArtifacts(explanationFromChapter8), "an unfair result. Therefore");
    assert.equal(removeCitationArtifacts("A choice\u200B:contentReference[oaicite:12]{index=12}"), "A choice");
    assert.equal(removeCitationArtifacts("A question?:contentReference[oaicite:3]{index=3}"), "A question?");
    assert.equal(removeCitationArtifacts("No artifacts: RESA s.3"), "No artifacts: RESA s.3");
  });
});

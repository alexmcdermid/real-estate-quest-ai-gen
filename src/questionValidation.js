// The same rules and messages as validateAiQuestion in real-estate-quest/functions/aiQuestions.js, which checks a
// question again when it's approved, plus a duplicate check and a citation artifact check.
export const CHOICE_COUNT = 4;
export const QUESTION_MAX_LENGTH = 4000;
export const CHOICE_MAX_LENGTH = 1000;
export const EXPLANATION_MAX_LENGTH = 8000;

// ChatGPT citation artifacts left in some human questions, e.g. "&#8203;:contentReference[oaicite:0]{index=0}". The
// zero-width space in front can be the HTML entity, the character itself, or missing.
const CITATION_ARTIFACT_TEXT = "contentReference[oaicite";
const CITATION_ARTIFACT_PATTERN = /(?:&#8203;|\u200B)?:contentReference\[oaicite:\d+\]\{index=\d+\}/g;

/**
 * Removes ChatGPT citation artifacts, so Claude doesn't copy them from the questions it is shown.
 */
export function removeCitationArtifacts(text) {
  return text.replace(CITATION_ARTIFACT_PATTERN, "");
}

/**
 * Lowercases, collapses whitespace and trims, so the same question with different spacing or case compares equal.
 */
export function normalizeQuestionText(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Validates one generated question. Values are trimmed first, and the trimmed values are returned.
 *
 * @param {object} candidate - {question, choices, correctChoice, explanation} from Claude
 * @param {{existingQuestionTexts: Set<string>}} options - normalized texts (see normalizeQuestionText) the question
 *   must not duplicate
 * @return {{valid: true, question: object} | {valid: false, errors: string[]}}
 */
export function validateGeneratedQuestion(candidate, { existingQuestionTexts }) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: ["Question must be an object"] };
  }

  const errors = [];

  const question = typeof candidate.question === "string" ? candidate.question.trim() : "";
  if (!question) {
    errors.push("Question must be non-empty text");
  } else if (question.length > QUESTION_MAX_LENGTH) {
    errors.push(`Question must be at most ${QUESTION_MAX_LENGTH} characters`);
  } else if (existingQuestionTexts.has(normalizeQuestionText(question))) {
    errors.push("Question duplicates an existing question");
  }

  let choices = [];
  if (!Array.isArray(candidate.choices) || candidate.choices.length !== CHOICE_COUNT) {
    errors.push(`There must be exactly ${CHOICE_COUNT} choices`);
  } else {
    choices = candidate.choices.map((choice) => (typeof choice === "string" ? choice.trim() : ""));
    choices.forEach((choice, choiceIndex) => {
      if (!choice) {
        errors.push(`Choice ${choiceIndex + 1} must be non-empty text`);
      } else if (choice.length > CHOICE_MAX_LENGTH) {
        errors.push(`Choice ${choiceIndex + 1} must be at most ${CHOICE_MAX_LENGTH} characters`);
      }
    });
    const everyChoiceHasText = choices.every(Boolean);
    const distinctChoiceCount = new Set(choices.map((choice) => choice.toLowerCase())).size;
    if (everyChoiceHasText && distinctChoiceCount !== choices.length) errors.push("Choices must all be different");
  }

  const { correctChoice } = candidate;
  const correctChoiceIsValid = Number.isInteger(correctChoice) && correctChoice >= 0 && correctChoice < CHOICE_COUNT;
  if (!correctChoiceIsValid) errors.push(`Correct choice must be an integer from 0 to ${CHOICE_COUNT - 1}`);

  const explanation = typeof candidate.explanation === "string" ? candidate.explanation.trim() : "";
  if (!explanation) {
    errors.push("Explanation must be non-empty text");
  } else {
    if (explanation.length > EXPLANATION_MAX_LENGTH) {
      errors.push(`Explanation must be at most ${EXPLANATION_MAX_LENGTH} characters`);
    }
    const expectedExplanationStart = `Correct Answer: ${correctChoice + 1}`;
    if (correctChoiceIsValid && !explanation.startsWith(expectedExplanationStart)) {
      errors.push(`Explanation must start with "${expectedExplanationStart}"`);
    }
  }

  if ([question, ...choices, explanation].some((text) => text.includes(CITATION_ARTIFACT_TEXT))) {
    errors.push(`Question, choices and explanation must not contain "${CITATION_ARTIFACT_TEXT}" (a ChatGPT citation artifact)`);
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, question: { question, choices, correctChoice, explanation } };
}

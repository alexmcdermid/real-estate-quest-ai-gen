import { CITATION_ARTIFACT_TEXT, normalizeForDuplicateCheck } from "./textChecks.js";

// The same rules as validateAiFlashcard in real-estate-quest/functions/aiFlashcards.js, which checks a flashcard
// again when it's approved, plus a duplicate check and a citation artifact check. The human flashcards' longest front
// is 43 characters and their longest back 326.
export const FRONT_MAX_LENGTH = 100;
export const BACK_MAX_LENGTH = 600;
export const MIN_TAG_COUNT = 1;
export const MAX_TAG_COUNT = 5;
export const TAG_MAX_LENGTH = 40;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 3;

/**
 * Validates one generated flashcard. Values are trimmed first, tags are also lowercased and deduplicated, and those
 * normalized values are returned.
 *
 * @param {object} candidate - {front, back, tags, difficulty} from Claude
 * @param {{existingFronts: Set<string>}} options - normalized fronts (see normalizeForDuplicateCheck) the flashcard
 *   must not duplicate
 * @return {{valid: true, flashcard: object} | {valid: false, errors: string[]}}
 */
export function validateGeneratedFlashcard(candidate, { existingFronts }) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: ["Flashcard must be an object"] };
  }

  const errors = [];

  const front = typeof candidate.front === "string" ? candidate.front.trim() : "";
  if (!front) {
    errors.push("Front must be non-empty text");
  } else if (front.length > FRONT_MAX_LENGTH) {
    errors.push(`Front must be at most ${FRONT_MAX_LENGTH} characters`);
  } else if (existingFronts.has(normalizeForDuplicateCheck(front))) {
    errors.push("Front duplicates an existing flashcard");
  }

  const back = typeof candidate.back === "string" ? candidate.back.trim() : "";
  if (!back) {
    errors.push("Back must be non-empty text");
  } else if (back.length > BACK_MAX_LENGTH) {
    errors.push(`Back must be at most ${BACK_MAX_LENGTH} characters`);
  }

  let tags = [];
  if (Array.isArray(candidate.tags)) {
    const normalizedTags = candidate.tags.map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""));
    normalizedTags.forEach((tag, tagIndex) => {
      if (!tag) {
        errors.push(`Tag ${tagIndex + 1} must be non-empty text`);
      } else if (tag.length > TAG_MAX_LENGTH) {
        errors.push(`Tag ${tagIndex + 1} must be at most ${TAG_MAX_LENGTH} characters`);
      }
    });
    tags = [...new Set(normalizedTags)];
  }
  if (tags.length < MIN_TAG_COUNT || tags.length > MAX_TAG_COUNT) {
    errors.push(`There must be ${MIN_TAG_COUNT} to ${MAX_TAG_COUNT} different tags`);
  }

  const { difficulty } = candidate;
  if (!Number.isInteger(difficulty) || difficulty < MIN_DIFFICULTY || difficulty > MAX_DIFFICULTY) {
    errors.push(`Difficulty must be an integer from ${MIN_DIFFICULTY} to ${MAX_DIFFICULTY}`);
  }

  if ([front, back].some((text) => text.includes(CITATION_ARTIFACT_TEXT))) {
    errors.push(`Front and back must not contain "${CITATION_ARTIFACT_TEXT}" (a ChatGPT citation artifact)`);
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, flashcard: { front, back, tags, difficulty } };
}

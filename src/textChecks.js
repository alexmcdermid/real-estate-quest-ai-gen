// Text helpers both content types share: ChatGPT citation artifacts, and the normalization the duplicate checks
// compare.

// ChatGPT citation artifacts left in some human questions, e.g. "&#8203;:contentReference[oaicite:0]{index=0}". The
// zero-width space in front can be the HTML entity, the character itself, or missing.
export const CITATION_ARTIFACT_TEXT = "contentReference[oaicite";
const CITATION_ARTIFACT_PATTERN = /(?:&#8203;|​)?:contentReference\[oaicite:\d+\]\{index=\d+\}/g;

/**
 * Removes ChatGPT citation artifacts, so Claude doesn't copy them from the questions and flashcards it is shown.
 */
export function removeCitationArtifacts(text) {
  return text.replace(CITATION_ARTIFACT_PATTERN, "");
}

/**
 * Lowercases, collapses whitespace and trims, so the same question text or flashcard front with different spacing or
 * case compares equal.
 */
export function normalizeForDuplicateCheck(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

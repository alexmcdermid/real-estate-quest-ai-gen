// Same behavior as normalizeAiSettings in real-estate-quest/functions/aiContent.js.
export const DEFAULT_ITEMS_PER_RUN = 1;
export const MAX_ITEMS_PER_RUN = 10;

/**
 * True for an integer item (question or flashcard) count from 1 to MAX_ITEMS_PER_RUN.
 */
export function isValidItemCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_ITEMS_PER_RUN;
}

/**
 * Turns the metadata/aiContent document (or undefined when it doesn't exist) into complete settings.
 * Missing switches are off, and questionsPerRun and flashcardsPerRun are integers clamped to 1..MAX_ITEMS_PER_RUN.
 */
export function normalizeAiSettings(data) {
  return {
    generationEnabled: data?.generationEnabled === true,
    servingEnabled: data?.servingEnabled === true,
    questionsPerRun: clampItemsPerRun(data?.questionsPerRun),
    flashcardsPerRun: clampItemsPerRun(data?.flashcardsPerRun),
  };
}

/**
 * A stored per-run count as an integer from 1 to MAX_ITEMS_PER_RUN. Missing or unreadable means the default.
 */
function clampItemsPerRun(value) {
  const parsedItemsPerRun = Number(value);
  return Number.isFinite(parsedItemsPerRun)
    ? Math.min(MAX_ITEMS_PER_RUN, Math.max(1, Math.trunc(parsedItemsPerRun)))
    : DEFAULT_ITEMS_PER_RUN;
}

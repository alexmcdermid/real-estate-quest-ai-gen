// Same behavior as normalizeAiSettings in real-estate-quest/functions/aiQuestions.js.
export const DEFAULT_QUESTIONS_PER_RUN = 1;
export const MAX_QUESTIONS_PER_RUN = 10;

/**
 * True for an integer question count from 1 to MAX_QUESTIONS_PER_RUN.
 */
export function isValidQuestionCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_QUESTIONS_PER_RUN;
}

/**
 * Turns the metadata/aiQuestions document (or undefined when it doesn't exist) into complete settings.
 * Missing switches are off, and questionsPerRun is an integer clamped to 1..MAX_QUESTIONS_PER_RUN.
 */
export function normalizeAiSettings(data) {
  const parsedQuestionsPerRun = Number(data?.questionsPerRun);
  const questionsPerRun = Number.isFinite(parsedQuestionsPerRun)
    ? Math.min(MAX_QUESTIONS_PER_RUN, Math.max(1, Math.trunc(parsedQuestionsPerRun)))
    : DEFAULT_QUESTIONS_PER_RUN;
  return {
    generationEnabled: data?.generationEnabled === true,
    servingEnabled: data?.servingEnabled === true,
    questionsPerRun,
  };
}

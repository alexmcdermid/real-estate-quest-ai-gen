// Kept apart from runGeneration.js so callers that don't use Firestore (the preview script) can import it.
const MAX_ATTEMPTS = 3;

/**
 * The attempt loop. Each attempt asks requestBatch for the questions still missing (passing the ones accepted so far),
 * validates every candidate, and keeps valid ones up to requestedQuestionCount. Validation, response and request
 * errors are recorded per attempt ("attempt 2: ..."); a thrown request error doesn't stop the next attempt.
 *
 * @param {object} options
 * @param {number} options.requestedQuestionCount - how many valid questions to collect
 * @param {number} options.maxAttempts - how many requests to make at most
 * @param {function} options.requestBatch - ({questionCount, acceptedQuestions}) => Promise<{questions, model,
 *   inputTokens, outputTokens, error}>, as returned by requestQuestionBatch
 * @param {function} options.validate - (candidate, {acceptedQuestions}) => validateGeneratedQuestion's result
 * @return {Promise<{acceptedQuestions: object[], errors: string[], model: string|null, inputTokens: number,
 *   outputTokens: number}>} each accepted question also carries the model that wrote it
 */
export async function collectValidQuestions({ requestedQuestionCount, maxAttempts = MAX_ATTEMPTS, requestBatch, validate }) {
  const acceptedQuestions = [];
  const errors = [];
  let model = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= maxAttempts && acceptedQuestions.length < requestedQuestionCount; attempt++) {
    const remainingQuestionCount = requestedQuestionCount - acceptedQuestions.length;

    let batch;
    try {
      batch = await requestBatch({ questionCount: remainingQuestionCount, acceptedQuestions: [...acceptedQuestions] });
    } catch (error) {
      errors.push(`attempt ${attempt}: request failed: ${error.message}`);
      continue;
    }

    model = batch.model ?? model;
    inputTokens += batch.inputTokens ?? 0;
    outputTokens += batch.outputTokens ?? 0;

    const candidates = batch.questions ?? [];
    if (batch.error) {
      errors.push(`attempt ${attempt}: ${batch.error}`);
    } else if (candidates.length < remainingQuestionCount) {
      errors.push(`attempt ${attempt}: received ${candidates.length} of ${remainingQuestionCount} requested questions`);
    }

    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (acceptedQuestions.length >= requestedQuestionCount) break;
      const validation = validate(candidate, { acceptedQuestions });
      if (validation.valid) {
        acceptedQuestions.push({ ...validation.question, model: batch.model ?? null });
      } else {
        errors.push(`attempt ${attempt}: question ${candidateIndex + 1}: ${validation.errors.join("; ")}`);
      }
    }
  }

  return { acceptedQuestions, errors, model, inputTokens, outputTokens };
}

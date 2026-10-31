// Kept apart from runGeneration.js so callers that don't use Firestore (the preview script) can import it.
const MAX_ATTEMPTS = 3;

/**
 * The attempt loop, for questions and flashcards alike. Each attempt asks requestBatch for the items still missing
 * (passing the ones accepted so far), validates every candidate, and keeps valid ones up to requestedItemCount.
 * Validation, response and request errors are recorded per attempt ("attempt 2: ..."); a thrown request error doesn't
 * stop the next attempt.
 *
 * @param {object} options
 * @param {number} options.requestedItemCount - how many valid items to collect
 * @param {string} options.itemName - the item's name in the error messages: "question" or "flashcard"
 * @param {number} options.maxAttempts - how many requests to make at most
 * @param {function} options.requestBatch - ({itemCount, acceptedItems}) => Promise<{items, model, inputTokens,
 *   outputTokens, error}>, as returned by requestClaudeBatch
 * @param {function} options.validate - (candidate, {acceptedItems}) => {valid: true, item} | {valid: false, errors}
 * @return {Promise<{acceptedItems: object[], errors: string[], model: string|null, inputTokens: number,
 *   outputTokens: number}>} each accepted item also carries the model that wrote it
 */
export async function collectValidItems({ requestedItemCount, itemName, maxAttempts = MAX_ATTEMPTS, requestBatch, validate }) {
  const acceptedItems = [];
  const errors = [];
  let model = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 1; attempt <= maxAttempts && acceptedItems.length < requestedItemCount; attempt++) {
    const remainingItemCount = requestedItemCount - acceptedItems.length;

    let batch;
    try {
      batch = await requestBatch({ itemCount: remainingItemCount, acceptedItems: [...acceptedItems] });
    } catch (error) {
      errors.push(`attempt ${attempt}: request failed: ${error.message}`);
      continue;
    }

    model = batch.model ?? model;
    inputTokens += batch.inputTokens ?? 0;
    outputTokens += batch.outputTokens ?? 0;

    const candidates = batch.items ?? [];
    if (batch.error) {
      errors.push(`attempt ${attempt}: ${batch.error}`);
    } else if (candidates.length < remainingItemCount) {
      errors.push(`attempt ${attempt}: received ${candidates.length} of ${remainingItemCount} requested ${itemName}s`);
    }

    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (acceptedItems.length >= requestedItemCount) break;
      const validation = validate(candidate, { acceptedItems });
      if (validation.valid) {
        acceptedItems.push({ ...validation.item, model: batch.model ?? null });
      } else {
        errors.push(`attempt ${attempt}: ${itemName} ${candidateIndex + 1}: ${validation.errors.join("; ")}`);
      }
    }
  }

  return { acceptedItems, errors, model, inputTokens, outputTokens };
}

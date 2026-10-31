// Shared by generateQuestions.js and generateFlashcards.js: the Claude request and its response handling, and the
// context lines both prompts contain.
import { removeCitationArtifacts } from "./textChecks.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

/**
 * Asks Claude for one batch of items (questions or flashcards) in one request, with structured output.
 * Response problems (refusal, max_tokens, unparseable JSON, no items array) come back as `error` with no items;
 * request failures (network, API errors) throw.
 *
 * @param {object} options
 * @param {object} options.anthropicClient - an Anthropic SDK client
 * @param {string} options.systemPrompt - the system prompt
 * @param {object} options.batchSchema - the JSON schema of the response: an object with one array property
 * @param {string} options.itemsPropertyName - that array property, e.g. "questions"
 * @param {string} options.chapterContextText - the first content block, cached
 * @param {string} options.instructionText - the second content block
 * @return {Promise<{items: object[], model: string|null, inputTokens: number, outputTokens: number,
 *   error: string|null}>} items are unvalidated candidates
 */
export async function requestClaudeBatch({
  anthropicClient,
  systemPrompt,
  batchSchema,
  itemsPropertyName,
  chapterContextText,
  instructionText,
}) {
  const message = await anthropicClient.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: batchSchema } },
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        // Identical for every attempt in a run, so retries read it from the prompt cache.
        { type: "text", text: chapterContextText, cache_control: { type: "ephemeral" } },
        { type: "text", text: instructionText },
      ],
    }],
  }).finalMessage();

  return readBatchResponse(message, itemsPropertyName);
}

/**
 * Turns a finished message into a batch result. Never reads content[0]: the response starts with thinking blocks.
 */
function readBatchResponse(message, itemsPropertyName) {
  const usage = message.usage ?? {};
  const result = {
    items: [],
    model: message.model ?? null,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    error: null,
  };

  if (message.stop_reason === "refusal") {
    return { ...result, error: `Claude declined the request (category: ${message.stop_details?.category ?? "none"})` };
  }
  if (message.stop_reason === "max_tokens") {
    return { ...result, error: "The response hit max_tokens before the JSON was complete" };
  }

  // A model that declines mid-response leaves its partial output before a fallback block. On a stream the fallback
  // model continues that partial output, so the JSON is every text block joined in order; a fallback model that
  // starts over writes the whole JSON after the last fallback block. Try the text after that block first.
  const content = message.content ?? [];
  const lastFallbackIndex = content.findLastIndex((block) => block.type === "fallback");
  const candidateResponseTexts = lastFallbackIndex === -1 ?
    [joinTextBlocks(content)] :
    [joinTextBlocks(content.slice(lastFallbackIndex + 1)), joinTextBlocks(content)];

  let parsedResponse;
  try {
    parsedResponse = parseFirstValidJson(candidateResponseTexts);
  } catch (error) {
    return { ...result, error: `The response was not valid JSON (${error.message})` };
  }
  if (!Array.isArray(parsedResponse?.[itemsPropertyName])) {
    return { ...result, error: `The response JSON has no ${itemsPropertyName} array` };
  }
  return { ...result, items: parsedResponse[itemsPropertyName] };
}

/**
 * The text of the text blocks among contentBlocks, joined in order.
 */
function joinTextBlocks(contentBlocks) {
  return contentBlocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * JSON.parse of the first candidate text that parses. Throws the last parse error when none does.
 */
function parseFirstValidJson(candidateTexts) {
  let lastParseError;
  for (const candidateText of candidateTexts) {
    try {
      return JSON.parse(candidateText);
    } catch (error) {
      lastParseError = error;
    }
  }
  throw lastParseError;
}

/**
 * The chapter's course manual topics grouped by manual chapter, then a blank line. No lines while the chapter has no
 * manual chapters.
 *
 * @param {object[]} manualChapters - from getManualChapters
 * @param {object} guidance
 * @param {string} guidance.topicsRequirement - the sentence that ends the topics heading, e.g. "Every question must
 *   test one of these topics."
 * @return {string[]} the lines
 */
export function formatManualChapterLines(manualChapters, { topicsRequirement }) {
  if (manualChapters.length === 0) return [];
  return [
    "WHAT THIS CHAPTER COVERS: the section headings of the UBC Real Estate Trading Services Licensing Course Manual " +
      `(2024 edition) chapters it is based on. ${topicsRequirement}`,
    ...manualChapters.flatMap((manualChapter) => [
      `Manual chapter ${manualChapter.number}, ${manualChapter.title}:`,
      ...manualChapter.topics.map((topic) => `- ${topic}`),
    ]),
    "",
  ];
}

/**
 * One JSON object per line with only the given fields, or "(none)". Every string (including each choice and tag)
 * goes in without ChatGPT citation artifacts, so Claude doesn't imitate them.
 */
export function formatJsonLines(items, fieldNames) {
  if (items.length === 0) return "(none)";
  return items
    .map((item) => Object.fromEntries(fieldNames.map((fieldName) => [fieldName, item[fieldName]])))
    .map((pickedFields) => JSON.stringify(pickedFields, removeCitationArtifactsFromStrings))
    .join("\n");
}

/**
 * A JSON.stringify replacer that removes citation artifacts from every string value.
 */
function removeCitationArtifactsFromStrings(key, value) {
  return typeof value === "string" ? removeCitationArtifacts(value) : value;
}

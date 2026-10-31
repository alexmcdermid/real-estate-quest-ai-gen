import { removeCitationArtifacts } from "./questionValidation.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

// Structured outputs guarantee this shape. Counts and lengths aren't expressible here (no minItems/maxItems/minLength
// support), so questionValidation.js checks them.
export const QUESTION_BATCH_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          correctChoice: { type: "integer", enum: [0, 1, 2, 3] },
          explanation: { type: "string" },
        },
        required: ["question", "choices", "correctChoice", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You are an expert question writer for the BC Real Estate Council (RECBC) licensing examination in British Columbia, Canada.

Your questions must conform to the following rules of the BC real estate licensing exam:
- Questions test knowledge of BC-specific real estate law, the Real Estate Services Act (RESA), the Real Estate Development Marketing Act (REDMA), the Land Title Act, agency relationships, ethics, and trading services as defined by the UBC Sauder Real Estate Division course materials
- All monetary amounts, time limits, deadlines, and statutory figures must be accurate under current BC legislation
- Plausible distractors: all four choices must be reasonable — never obviously wrong
- Only one choice is unambiguously correct
- Avoid trick questions or ambiguous wording
- Questions may present a scenario ("A licensee does X. Which of the following is TRUE?"), a direct knowledge test ("Which of the following correctly describes...?"), or multi-statement format (numbered statements 1–4 in the question body, with choices like "1 and 3 only", "2 and 4 only", "All of the above", etc.)
- Difficulty should match a licensing-level exam, not a trivia quiz
- When you write several questions at once, each one tests a different topic or scenario

EXPLANATION FORMAT RULES — follow exactly, for every question:
- Always begin with "Correct Answer: N" where N is the 1-based position of the correct choice (e.g. correctChoice 0 → "Correct Answer: 1", correctChoice 2 → "Correct Answer: 3")
- Follow with two newlines, then a paragraph explaining why the correct answer is right
- For multi-statement questions, address each numbered statement individually (e.g. "Statement (2) is incorrect because...")
- Cite the relevant BC legislation, regulation, or principle (e.g. RESA s.3, Land Title Act, RECBC Rules)
- Explain why common distractors are wrong where helpful`;

/**
 * Asks Claude for questionCount new questions for one chapter, in one request.
 * Response problems (refusal, max_tokens, unparseable JSON) come back as `error` with no questions;
 * request failures (network, API errors) throw.
 *
 * @return {Promise<{questions: object[], model: string|null, inputTokens: number, outputTokens: number,
 *   error: string|null}>} questions are unvalidated candidates
 */
export async function requestQuestionBatch({
  anthropicClient,
  chapter,
  chapterName,
  humanQuestions,
  liveAiQuestions,
  previousAiQuestions,
  acceptedQuestions,
  questionCount,
}) {
  const chapterContextText = buildChapterContextText({
    chapter,
    chapterName,
    humanQuestions,
    liveAiQuestions,
    previousAiQuestions,
  });
  const instructionText = buildInstructionText({ chapter, questionCount, acceptedQuestions });

  const message = await anthropicClient.beta.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema", schema: QUESTION_BATCH_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        // Identical for every attempt in a run, so retries read it from the prompt cache.
        { type: "text", text: chapterContextText, cache_control: { type: "ephemeral" } },
        { type: "text", text: instructionText },
      ],
    }],
  }).finalMessage();

  return readQuestionBatchResponse(message);
}

/**
 * Turns a finished message into a question batch result. Never reads content[0]: the response starts with
 * thinking blocks.
 */
function readQuestionBatchResponse(message) {
  const usage = message.usage ?? {};
  const result = {
    questions: [],
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
  if (!Array.isArray(parsedResponse?.questions)) {
    return { ...result, error: "The response JSON has no questions array" };
  }
  return { ...result, questions: parsedResponse.questions };
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
 * The cached first block: the chapter, its human questions as the style reference, and every earlier AI question
 * whose topic must not be repeated.
 */
function buildChapterContextText({ chapter, chapterName, humanQuestions, liveAiQuestions, previousAiQuestions }) {
  return [
    `Chapter ${chapter}: ${chapterName}`,
    "",
    `HUMAN-WRITTEN QUESTIONS (${humanQuestions.length}): your reference for topic coverage, style, difficulty, ` +
      "and format. Do not reproduce any of them.",
    formatQuestionLines(humanQuestions, ["question", "choices", "correctChoice", "explanation"]),
    "",
    `PUBLISHED AI-GENERATED QUESTIONS (${liveAiQuestions.length}): already live for students. ` +
      "Do not repeat their topics or scenarios.",
    formatQuestionLines(liveAiQuestions, ["question", "choices"]),
    "",
    `EARLIER AI-GENERATED QUESTIONS (${previousAiQuestions.length}): generated before and then approved, rejected, ` +
      "or still waiting for review. Do not repeat their topics or scenarios.",
    formatQuestionLines(previousAiQuestions, ["question", "choices"]),
  ].join("\n");
}

/**
 * The second block: what to write. On retries it lists the questions this run already accepted.
 */
function buildInstructionText({ chapter, questionCount, acceptedQuestions }) {
  const lines = [
    `Write exactly ${questionCount} new, original ${questionCount === 1 ? "question" : "questions"} for Chapter ${chapter}.`,
    "",
    "Requirements for each question:",
    "- It covers a topic or scenario that no question above covers, and that no other question you write now covers",
    "- It matches the style, difficulty, and format of the human-written questions",
    "- It has exactly 4 answer choices, all different, given only in \"choices\" " +
      "(don't also list them in the question text)",
    "- \"correctChoice\" is the 0-based index of the correct answer in \"choices\"",
    "- \"explanation\" starts with \"Correct Answer: N\" (N = correctChoice + 1), then two newlines, " +
      "then the explanation body",
  ];
  if (acceptedQuestions.length > 0) {
    lines.push(
      "",
      "Already written for this chapter in this run. Don't repeat their topics or scenarios:",
      formatQuestionLines(acceptedQuestions, ["question", "choices"]),
    );
  }
  return lines.join("\n");
}

/**
 * One JSON object per line with only the given fields, or "(none)". Every string (question, choices, explanation)
 * goes in without ChatGPT citation artifacts, so Claude doesn't imitate them.
 */
function formatQuestionLines(questions, fieldNames) {
  if (questions.length === 0) return "(none)";
  return questions
    .map((question) => Object.fromEntries(fieldNames.map((fieldName) => [fieldName, question[fieldName]])))
    .map((pickedFields) => JSON.stringify(pickedFields, removeCitationArtifactsFromStrings))
    .join("\n");
}

/**
 * A JSON.stringify replacer that removes citation artifacts from every string value, including each choice.
 */
function removeCitationArtifactsFromStrings(key, value) {
  return typeof value === "string" ? removeCitationArtifacts(value) : value;
}

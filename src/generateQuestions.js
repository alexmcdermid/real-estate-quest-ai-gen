import { formatJsonLines, formatManualChapterLines, requestClaudeBatch } from "./claudeBatchRequest.js";

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
          question: {
            type: "string",
            description: "The question text: a scenario, a direct knowledge question, or numbered statements 1-4 on " +
              "their own lines. Don't list the answer choices here.",
          },
          choices: {
            type: "array",
            items: { type: "string" },
            description: "Exactly 4 different answer choices, all plausible, exactly one correct.",
          },
          correctChoice: {
            type: "integer",
            enum: [0, 1, 2, 3],
            description: "The 0-based index of the correct answer in choices.",
          },
          explanation: {
            type: "string",
            description: "Starts with \"Correct Answer: N\" (N = correctChoice + 1), then two newlines, then why the " +
              "answer is right and why the main distractors are wrong, citing the BC statute, regulation or rule.",
          },
        },
        required: ["question", "choices", "correctChoice", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

export const QUESTION_SYSTEM_PROMPT = `You are an expert question writer for the BC Real Estate Council (RECBC) licensing examination in British Columbia, Canada.

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
 * Asks Claude for questionCount new questions for one chapter, in one request (see requestClaudeBatch).
 *
 * @return {Promise<{items: object[], model: string|null, inputTokens: number, outputTokens: number,
 *   error: string|null}>} items are unvalidated question candidates
 */
export async function requestQuestionBatch({
  anthropicClient,
  chapter,
  chapterName,
  manualChapters = [],
  humanQuestions,
  liveAiQuestions,
  previousAiQuestions,
  acceptedQuestions,
  questionCount,
}) {
  return requestClaudeBatch({
    anthropicClient,
    systemPrompt: QUESTION_SYSTEM_PROMPT,
    batchSchema: QUESTION_BATCH_SCHEMA,
    itemsPropertyName: "questions",
    chapterContextText: buildChapterContextText({
      chapter,
      chapterName,
      manualChapters,
      humanQuestions,
      liveAiQuestions,
      previousAiQuestions,
    }),
    instructionText: buildInstructionText({
      chapter,
      questionCount,
      acceptedQuestions,
      hasManualTopics: manualChapters.length > 0,
    }),
  });
}

/**
 * The cached first block: the chapter, its course manual topics, its human questions as the style
 * reference, and every earlier AI question whose topic must not be repeated.
 */
function buildChapterContextText({
  chapter,
  chapterName,
  manualChapters,
  humanQuestions,
  liveAiQuestions,
  previousAiQuestions,
}) {
  return [
    `Chapter ${chapter}: ${chapterName}`,
    "",
    ...formatManualChapterLines(manualChapters, {
      topicsRequirement: "Every question must test one of these topics.",
    }),
    `HUMAN-WRITTEN QUESTIONS (${humanQuestions.length}): your reference for topic coverage, style, difficulty, ` +
      "and format. Do not reproduce any of them.",
    formatJsonLines(humanQuestions, ["question", "choices", "correctChoice", "explanation"]),
    "",
    `PUBLISHED AI-GENERATED QUESTIONS (${liveAiQuestions.length}): already live for students. ` +
      "Do not repeat their topics or scenarios.",
    formatJsonLines(liveAiQuestions, ["question", "choices"]),
    "",
    `EARLIER AI-GENERATED QUESTIONS (${previousAiQuestions.length}): generated before and then approved, rejected, ` +
      "or still waiting for review. Do not repeat their topics or scenarios.",
    formatJsonLines(previousAiQuestions, ["question", "choices"]),
  ].join("\n");
}

/**
 * The second block: what to write. On retries it lists the questions this run already accepted.
 */
function buildInstructionText({ chapter, questionCount, acceptedQuestions, hasManualTopics }) {
  const lines = [
    `Write exactly ${questionCount} new, original ${questionCount === 1 ? "question" : "questions"} for Chapter ${chapter}.`,
    "",
    "Requirements for each question:",
    ...(hasManualTopics ? ["- It tests one of the course manual topics listed for this chapter"] : []),
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
      formatJsonLines(acceptedQuestions, ["question", "choices"]),
    );
  }
  return lines.join("\n");
}

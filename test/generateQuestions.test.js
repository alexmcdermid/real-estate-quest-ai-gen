import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QUESTION_BATCH_SCHEMA, SYSTEM_PROMPT, requestQuestionBatch } from "../src/generateQuestions.js";

const generatedQuestion = {
  question: "Which of the following must a licensee disclose to a client?",
  choices: ["A conflict of interest", "Their commission split", "Their home address", "Their brokerage's revenue"],
  correctChoice: 0,
  explanation: "Correct Answer: 1\n\nA licensee must disclose any conflict of interest.",
};
const humanQuestion = {
  chapter: 3,
  questionNumber: 1,
  question: "What is the greatest estate in land?",
  choices: ["A life estate", "A fee simple estate", "A leasehold", "A license"],
  correctChoice: 1,
  premium: false,
  explanation: "Fee simple is the largest estate.",
};

/**
 * A client whose stream(params).finalMessage() resolves to `message`, recording every params object it's called with.
 */
function createFakeAnthropicClient(message) {
  const requests = [];
  const client = {
    beta: {
      messages: {
        stream: (params) => {
          requests.push(params);
          return { finalMessage: async () => message };
        },
      },
    },
  };
  return { client, requests };
}

/**
 * A finished message with the given content blocks and stop reason.
 */
function createMessage(content, { stopReason = "end_turn", stopDetails = null, model = "claude-opus-5-5" } = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_details: stopDetails,
    usage: { input_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300, output_tokens: 1500 },
  };
}

/**
 * Calls requestQuestionBatch with a fake client and a small chapter context.
 */
async function requestWithMessage(message, overrides = {}) {
  const { client, requests } = createFakeAnthropicClient(message);
  const result = await requestQuestionBatch({
    anthropicClient: client,
    chapter: 3,
    chapterName: "The Professional Liability of Real Estate Licensees",
    humanQuestions: [humanQuestion],
    liveAiQuestions: [{ question: "A live AI question?", choices: ["1", "2", "3", "4"], correctChoice: 0, explanation: "x" }],
    previousAiQuestions: [{ question: "A rejected AI question?", choices: ["a", "b", "c", "d"], status: "rejected" }],
    acceptedQuestions: [],
    questionCount: 2,
    ...overrides,
  });
  return { result, requests };
}

const thinkingBlock = { type: "thinking", thinking: "", signature: "sig" };
const fallbackBlock = {
  type: "fallback",
  from: { model: "claude-opus-5-5" },
  to: { model: "claude-opus-5" },
  trigger: { type: "refusal" },
};

describe("requestQuestionBatch", () => {
  test("parses the text block that follows the thinking block", async () => {
    const message = createMessage([thinkingBlock, { type: "text", text: JSON.stringify({ questions: [generatedQuestion] }) }]);
    const { result } = await requestWithMessage(message);
    assert.deepEqual(result, {
      questions: [generatedQuestion],
      model: "claude-opus-5-5",
      inputTokens: 2400,
      outputTokens: 1500,
      error: null,
    });
  });

  test("treats a missing usage breakdown as zero tokens", async () => {
    const message = createMessage([{ type: "text", text: JSON.stringify({ questions: [] }) }]);
    message.usage = { input_tokens: 10, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: 5 };
    const { result } = await requestWithMessage(message);
    assert.equal(result.inputTokens, 10);
    assert.equal(result.outputTokens, 5);
  });

  test("returns an error and no questions on a refusal", async () => {
    const partialText = { type: "text", text: "{\"questions\": [" };
    const message = createMessage([thinkingBlock, partialText], {
      stopReason: "refusal",
      stopDetails: { type: "refusal", category: "cyber", explanation: null },
    });
    const { result } = await requestWithMessage(message);
    assert.deepEqual(result.questions, []);
    assert.equal(result.error, "Claude declined the request (category: cyber)");
    assert.equal(result.outputTokens, 1500);
  });

  test("reports category none when a refusal has no stop details", async () => {
    const { result } = await requestWithMessage(createMessage([], { stopReason: "refusal", stopDetails: null }));
    assert.equal(result.error, "Claude declined the request (category: none)");
  });

  test("returns an error on max_tokens", async () => {
    const message = createMessage([thinkingBlock, { type: "text", text: "{\"questions\": [{\"question\": \"Cut" }], {
      stopReason: "max_tokens",
    });
    const { result } = await requestWithMessage(message);
    assert.deepEqual(result.questions, []);
    assert.equal(result.error, "The response hit max_tokens before the JSON was complete");
  });

  test("uses only the text after the last fallback block when the fallback model started over", async () => {
    const message = createMessage([
      thinkingBlock,
      { type: "text", text: "{\"questions\": [{\"question\": \"Partial output from the declined model" },
      fallbackBlock,
      thinkingBlock,
      { type: "text", text: JSON.stringify({ questions: [generatedQuestion] }) },
    ], { model: "claude-opus-5" });
    const { result } = await requestWithMessage(message);
    assert.equal(result.error, null);
    assert.deepEqual(result.questions, [generatedQuestion]);
    assert.equal(result.model, "claude-opus-5");
  });

  test("joins the partial text before a fallback block with the continuation after it (streaming shape)", async () => {
    const responseText = JSON.stringify({ questions: [generatedQuestion] });
    const declinedAtIndex = responseText.indexOf("disclose to a client");
    const message = createMessage([
      thinkingBlock,
      { type: "text", text: responseText.slice(0, declinedAtIndex) },
      fallbackBlock,
      { type: "text", text: responseText.slice(declinedAtIndex) },
    ], { model: "claude-opus-5" });
    const { result } = await requestWithMessage(message);
    assert.equal(result.error, null);
    assert.deepEqual(result.questions, [generatedQuestion]);
    assert.equal(result.model, "claude-opus-5");
  });

  test("returns an error when neither the text after the fallback block nor every text block is JSON", async () => {
    const message = createMessage([
      { type: "text", text: "{\"questions\": [{\"question\": \"Partial" },
      fallbackBlock,
      { type: "text", text: "Here are your questions" },
    ]);
    const { result } = await requestWithMessage(message);
    assert.deepEqual(result.questions, []);
    assert.match(result.error, /^The response was not valid JSON/);
  });

  test("returns an error for text that isn't JSON", async () => {
    const message = createMessage([thinkingBlock, { type: "text", text: "Here are your questions" }]);
    const { result } = await requestWithMessage(message);
    assert.deepEqual(result.questions, []);
    assert.match(result.error, /^The response was not valid JSON/);
  });

  test("returns an error when there is no text block", async () => {
    const { result } = await requestWithMessage(createMessage([thinkingBlock]));
    assert.match(result.error, /^The response was not valid JSON/);
  });

  test("returns an error for JSON without a questions array", async () => {
    const { result } = await requestWithMessage(createMessage([{ type: "text", text: "{\"questions\": \"none\"}" }]));
    assert.deepEqual(result.questions, []);
    assert.equal(result.error, "The response JSON has no questions array");
  });

  test("lets request errors throw", async () => {
    const failingFinalMessage = async () => {
      throw new Error("529 overloaded");
    };
    const client = { beta: { messages: { stream: () => ({ finalMessage: failingFinalMessage }) } } };
    await assert.rejects(
      requestQuestionBatch({
        anthropicClient: client,
        chapter: 1,
        chapterName: "Chapter one",
        humanQuestions: [],
        liveAiQuestions: [],
        previousAiQuestions: [],
        acceptedQuestions: [],
        questionCount: 1,
      }),
      /529 overloaded/,
    );
  });

  test("sends the expected request", async () => {
    const message = createMessage([{ type: "text", text: JSON.stringify({ questions: [] }) }]);
    const { requests } = await requestWithMessage(message);
    assert.equal(requests.length, 1);
    const [params] = requests;

    assert.equal(params.model, "claude-opus-5-5");
    assert.equal(params.max_tokens, 64000);
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.deepEqual(params.output_config, {
      effort: "high",
      format: { type: "json_schema", schema: QUESTION_BATCH_SCHEMA },
    });
    assert.equal(params.system, SYSTEM_PROMPT);
    for (const removedField of ["thinking", "temperature", "top_p", "top_k", "tool_choice", "tools"]) {
      assert.equal(removedField in params, false, `${removedField} must not be sent`);
    }

    assert.equal(params.messages.length, 1);
    const [userMessage] = params.messages;
    assert.equal(userMessage.role, "user");
    assert.equal(userMessage.content.length, 2);
    const [contextBlock, instructionBlock] = userMessage.content;
    assert.deepEqual(contextBlock.cache_control, { type: "ephemeral" });
    assert.equal(instructionBlock.cache_control, undefined);

    assert.match(contextBlock.text, /Chapter 3: The Professional Liability of Real Estate Licensees/);
    assert.ok(contextBlock.text.includes(JSON.stringify({
      question: humanQuestion.question,
      choices: humanQuestion.choices,
      correctChoice: humanQuestion.correctChoice,
      explanation: humanQuestion.explanation,
    })), "human questions are sent with question, choices, correctChoice and explanation");
    assert.ok(contextBlock.text.includes("A live AI question?"));
    assert.ok(contextBlock.text.includes("A rejected AI question?"));
    assert.match(instructionBlock.text, /^Write exactly 2 new, original questions for Chapter 3\./);
    assert.doesNotMatch(instructionBlock.text, /already written/i);
  });

  test("removes ChatGPT citation artifacts from the context questions", async () => {
    const humanQuestionWithCitationArtifacts = {
      ...humanQuestion,
      question: `${humanQuestion.question}&#8203;:contentReference[oaicite:0]{index=0}`,
      choices: [`${humanQuestion.choices[0]}\u200B:contentReference[oaicite:1]{index=1}`, ...humanQuestion.choices.slice(1)],
      explanation: "Fee simple is the largest estate&#8203;:contentReference[oaicite:2]{index=2}" +
        "&#8203;:contentReference[oaicite:3]{index=3}.",
    };
    const message = createMessage([{ type: "text", text: JSON.stringify({ questions: [] }) }]);
    const { requests } = await requestWithMessage(message, {
      humanQuestions: [humanQuestionWithCitationArtifacts],
      liveAiQuestions: [{
        question: "A live AI question?:contentReference[oaicite:4]{index=4}",
        choices: ["1", "2", "3", "4"],
      }],
      previousAiQuestions: [{
        question: "A rejected AI question?",
        choices: ["a", "b&#8203;:contentReference[oaicite:5]{index=5}", "c", "d"],
      }],
    });

    const [contextBlock] = requests[0].messages[0].content;
    assert.ok(contextBlock.text.includes(JSON.stringify({
      question: humanQuestion.question,
      choices: humanQuestion.choices,
      correctChoice: humanQuestion.correctChoice,
      explanation: humanQuestion.explanation,
    })), "the human question is sent as if it had no citation artifacts");
    assert.ok(contextBlock.text.includes(JSON.stringify({ question: "A live AI question?", choices: ["1", "2", "3", "4"] })));
    assert.ok(contextBlock.text.includes(JSON.stringify({ question: "A rejected AI question?", choices: ["a", "b", "c", "d"] })));
    assert.doesNotMatch(contextBlock.text, /contentReference|oaicite|&#8203;|\u200B/);
  });

  test("lists the questions accepted earlier in the run on a retry, outside the cached block", async () => {
    const message = createMessage([{ type: "text", text: JSON.stringify({ questions: [] }) }]);
    const firstAttempt = await requestWithMessage(message, { questionCount: 2 });
    const retry = await requestWithMessage(message, { acceptedQuestions: [generatedQuestion], questionCount: 1 });

    const [firstContextBlock] = firstAttempt.requests[0].messages[0].content;
    const [retryContextBlock, retryInstructionBlock] = retry.requests[0].messages[0].content;
    assert.equal(retryContextBlock.text, firstContextBlock.text, "the cached block is identical across attempts");
    assert.match(retryInstructionBlock.text, /^Write exactly 1 new, original question for Chapter 3\./);
    assert.ok(retryInstructionBlock.text.includes(generatedQuestion.question));
  });
});

describe("course manual topics", () => {
  const validBatch = JSON.stringify({ questions: [generatedQuestion] });
  const manualChapters = [
    { number: 5, title: "The Professional Liability of Real Estate Licensees", topics: ["Negligence", "Breach of Fiduciary Duty"] },
  ];

  test("lists the chapter's topics in the cached context and requires each question to test one", async () => {
    const { requests } = await requestWithMessage(createMessage([thinkingBlock, { type: "text", text: validBatch }]), {
      manualChapters,
    });
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;
    assert.match(contextBlock.text, /WHAT THIS CHAPTER COVERS/);
    assert.match(contextBlock.text, /Manual chapter 5, The Professional Liability of Real Estate Licensees:\n- Negligence\n- Breach of Fiduciary Duty/);
    // The topics sit between the chapter heading and the example questions.
    assert.ok(contextBlock.text.indexOf("- Negligence") < contextBlock.text.indexOf("HUMAN-WRITTEN QUESTIONS"));
    assert.match(instructionBlock.text, /It tests one of the course manual topics listed for this chapter/);
  });

  test("leaves the topics out for a chapter that has none yet", async () => {
    const { requests } = await requestWithMessage(createMessage([thinkingBlock, { type: "text", text: validBatch }]), {
      manualChapters: [],
    });
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;
    assert.equal(contextBlock.text.includes("WHAT THIS CHAPTER COVERS"), false);
    assert.equal(instructionBlock.text.includes("course manual topics"), false);
  });
});


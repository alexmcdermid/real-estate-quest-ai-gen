import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FLASHCARD_BATCH_SCHEMA, FLASHCARD_SYSTEM_PROMPT, requestFlashcardBatch } from "../src/generateFlashcards.js";
import { requestQuestionBatch } from "../src/generateQuestions.js";
import { createFakeAnthropicClient, createJsonMessage, createMessage, thinkingBlock } from "./support/fakeAnthropicClient.js";

const generatedFlashcard = {
  front: "Dual Agency",
  back: "One licensee or brokerage representing both the buyer and the seller in the same transaction.",
  tags: ["definitions", "agency law"],
  difficulty: 2,
};
// As stored in the flashcards collection: every field of the human flashcards file.
const humanFlashcard = {
  documentID: "09f8e7d6-c5b4-3a19-8899-567890123456",
  cardNumber: 2,
  front: "Fiduciary",
  back: "A person who holds a position of trust and must act solely for another person's benefit.",
  chapter: 3,
  tags: ["definitions", "agency law", "ethics"],
  premium: true,
  difficulty: 1,
};
const liveAiFlashcard = {
  front: "Deceit",
  back: "LIVE AI BACK, NOT SENT",
  tags: ["definitions"],
  difficulty: 2,
  cardNumber: 1,
  aiGenerated: true,
};
const previousAiFlashcard = { front: "Negligence", back: "REJECTED AI BACK, NOT SENT", status: "rejected" };

/**
 * Calls requestFlashcardBatch with a fake client and a small chapter context.
 */
async function requestWithMessage(message, overrides = {}) {
  const { client, requests } = createFakeAnthropicClient([message]);
  const result = await requestFlashcardBatch({
    anthropicClient: client,
    chapter: 3,
    chapterName: "The Professional Liability of Real Estate Licensees",
    glossaryTermsWithoutFlashcard: ["Warranty of Authority", "Agency Contract"],
    humanFlashcards: [humanFlashcard],
    liveAiFlashcards: [liveAiFlashcard],
    previousAiFlashcards: [previousAiFlashcard],
    acceptedFlashcards: [],
    flashcardCount: 2,
    ...overrides,
  });
  return { result, requests };
}

/**
 * The request params with the parts that differ by content type (system prompt, schema, block texts) blanked out.
 */
function withoutContentTypeParts(params) {
  return {
    ...params,
    system: "<system prompt>",
    output_config: { ...params.output_config, format: { ...params.output_config.format, schema: "<schema>" } },
    messages: params.messages.map((message) => ({
      ...message,
      content: message.content.map((block) => ({ ...block, text: "<text>" })),
    })),
  };
}

describe("requestFlashcardBatch", () => {
  test("parses the flashcards array in the text block that follows the thinking block", async () => {
    const { result } = await requestWithMessage(createJsonMessage({ flashcards: [generatedFlashcard] }));
    assert.deepEqual(result, {
      items: [generatedFlashcard],
      model: "claude-opus-5-5",
      inputTokens: 2400,
      outputTokens: 1500,
      error: null,
    });
  });

  test("returns an error for JSON without a flashcards array", async () => {
    const { result } = await requestWithMessage(createJsonMessage({ questions: [generatedFlashcard] }));
    assert.deepEqual(result.items, []);
    assert.equal(result.error, "The response JSON has no flashcards array");
  });

  test("returns an error and no flashcards on a refusal or at max_tokens", async () => {
    const refusal = await requestWithMessage(createMessage([thinkingBlock], {
      stopReason: "refusal",
      stopDetails: { type: "refusal", category: "cyber", explanation: null },
    }));
    assert.deepEqual(refusal.result.items, []);
    assert.equal(refusal.result.error, "Claude declined the request (category: cyber)");

    const cutOff = await requestWithMessage(createMessage([{ type: "text", text: "{\"flashcards\": [" }], {
      stopReason: "max_tokens",
    }));
    assert.equal(cutOff.result.error, "The response hit max_tokens before the JSON was complete");
  });

  test("sends the same request as questions, apart from the schema, the system prompt and the texts", async () => {
    const { requests: flashcardRequests } = await requestWithMessage(createJsonMessage({ flashcards: [] }));
    const { client: questionClient, requests: questionRequests } = createFakeAnthropicClient([
      createJsonMessage({ questions: [] }),
    ]);
    await requestQuestionBatch({
      anthropicClient: questionClient,
      chapter: 3,
      chapterName: "The Professional Liability of Real Estate Licensees",
      humanQuestions: [],
      liveAiQuestions: [],
      previousAiQuestions: [],
      acceptedQuestions: [],
      questionCount: 2,
    });
    assert.deepEqual(withoutContentTypeParts(flashcardRequests[0]), withoutContentTypeParts(questionRequests[0]));

    const [params] = flashcardRequests;
    assert.equal(params.model, "claude-opus-5-5");
    assert.equal(params.max_tokens, 64000);
    assert.deepEqual(params.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(params.fallbacks, "default");
    assert.deepEqual(params.output_config, {
      effort: "high",
      format: { type: "json_schema", schema: FLASHCARD_BATCH_SCHEMA },
    });
    assert.equal(params.system, FLASHCARD_SYSTEM_PROMPT);
    for (const removedField of ["thinking", "temperature", "top_p", "top_k", "tool_choice", "tools"]) {
      assert.equal(removedField in params, false, `${removedField} must not be sent`);
    }
    const [contextBlock, instructionBlock] = params.messages[0].content;
    assert.deepEqual(contextBlock.cache_control, { type: "ephemeral" });
    assert.equal(instructionBlock.cache_control, undefined);
  });

  test("asks for front, back, tags and a difficulty of 1 to 3, all required", () => {
    assert.deepEqual(FLASHCARD_BATCH_SCHEMA, {
      type: "object",
      properties: {
        flashcards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              front: { type: "string" },
              back: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              difficulty: { type: "integer", enum: [1, 2, 3] },
            },
            required: ["front", "back", "tags", "difficulty"],
            additionalProperties: false,
          },
        },
      },
      required: ["flashcards"],
      additionalProperties: false,
    });
  });

  test("the system prompt sets the BC course and the card rules", () => {
    for (const expectedText of [
      "study flashcards for the BC real estate licensing course",
      "UBC Sauder Real Estate Division",
      "BCFSA",
      "RECBC",
      "Front: a key term or concept name, in a few words",
      "a precise, plain-language definition in your own words, 1–3 sentences",
      "accurate under current BC law and practice",
      "No trick content",
      "1 for a basic term, 2 for a standard term, 3 for a nuanced term",
      "\"definitions\" plus 1–3 topic tags",
    ]) {
      assert.ok(FLASHCARD_SYSTEM_PROMPT.includes(expectedText), expectedText);
    }
  });

  test("sends every human flashcard's front, back, tags and difficulty, and only the fronts of AI flashcards", async () => {
    const { requests } = await requestWithMessage(createJsonMessage({ flashcards: [] }));
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;

    assert.match(contextBlock.text, /^Chapter 3: The Professional Liability of Real Estate Licensees\n/);
    assert.match(contextBlock.text, /HUMAN-WRITTEN FLASHCARDS \(1\): .*Do not reproduce any of them\./);
    assert.ok(contextBlock.text.includes(JSON.stringify({
      front: humanFlashcard.front,
      back: humanFlashcard.back,
      tags: humanFlashcard.tags,
      difficulty: humanFlashcard.difficulty,
    })), "human flashcards are sent with front, back, tags and difficulty only");
    assert.match(contextBlock.text, /PUBLISHED AI-GENERATED FLASHCARDS \(1\): .*\n\{"front":"Deceit"\}\n/);
    assert.match(contextBlock.text, /EARLIER AI-GENERATED FLASHCARDS \(1\): .*\n\{"front":"Negligence"\}$/);
    assert.equal(contextBlock.text.includes("NOT SENT"), false, "AI flashcard backs stay out of the prompt");
    assert.equal(contextBlock.text.includes(humanFlashcard.documentID), false);

    assert.match(instructionBlock.text, /^Write exactly 2 new flashcards for Chapter 3\.\n/);
    assert.match(instructionBlock.text, /It is for a term or concept that no card above covers/);
    assert.match(instructionBlock.text, /It matches the style and length of the human-written flashcards/);
    assert.doesNotMatch(instructionBlock.text, /already written/i);
  });

  test("lists empty sections as (none)", async () => {
    const { requests } = await requestWithMessage(createJsonMessage({ flashcards: [] }), {
      humanFlashcards: [],
      liveAiFlashcards: [],
      previousAiFlashcards: [],
    });
    const [contextBlock] = requests[0].messages[0].content;
    assert.match(contextBlock.text, /HUMAN-WRITTEN FLASHCARDS \(0\): .*\n\(none\)\n/);
    assert.match(contextBlock.text, /EARLIER AI-GENERATED FLASHCARDS \(0\): .*\n\(none\)$/);
  });

  test("removes ChatGPT citation artifacts from the context flashcards", async () => {
    const citationArtifact = "&#8203;:contentReference[oaicite:0]{index=0}";
    const { requests } = await requestWithMessage(createJsonMessage({ flashcards: [] }), {
      humanFlashcards: [{
        ...humanFlashcard,
        front: `${humanFlashcard.front}${citationArtifact}`,
        back: `${humanFlashcard.back}​:contentReference[oaicite:1]{index=1}`,
        tags: ["definitions", `ethics:contentReference[oaicite:2]{index=2}`],
      }],
      liveAiFlashcards: [{ front: `Deceit${citationArtifact}` }],
    });
    const [contextBlock] = requests[0].messages[0].content;
    assert.ok(contextBlock.text.includes(JSON.stringify({
      front: humanFlashcard.front,
      back: humanFlashcard.back,
      tags: ["definitions", "ethics"],
      difficulty: humanFlashcard.difficulty,
    })), "the human flashcard is sent as if it had no citation artifacts");
    assert.ok(contextBlock.text.includes(JSON.stringify({ front: "Deceit" })));
    assert.doesNotMatch(contextBlock.text, /contentReference|oaicite|&#8203;|​/);
  });

  test("lists the fronts accepted earlier in the run on a retry, outside the cached block", async () => {
    const message = createJsonMessage({ flashcards: [] });
    const firstAttempt = await requestWithMessage(message, { flashcardCount: 2 });
    const retry = await requestWithMessage(message, { acceptedFlashcards: [generatedFlashcard], flashcardCount: 1 });

    const [firstContextBlock] = firstAttempt.requests[0].messages[0].content;
    const [retryContextBlock, retryInstructionBlock] = retry.requests[0].messages[0].content;
    assert.equal(retryContextBlock.text, firstContextBlock.text, "the cached block is identical across attempts");
    assert.match(retryInstructionBlock.text, /^Write exactly 1 new flashcard for Chapter 3\./);
    assert.match(retryInstructionBlock.text, /Already written for this chapter in this run\. .*\n\{"front":"Dual Agency"\}$/);
    assert.equal(retryInstructionBlock.text.includes(generatedFlashcard.back), false);
  });
});

describe("flashcard course manual topics and glossary terms", () => {
  const manualChapters = [{
    number: 5,
    title: "The Professional Liability of Real Estate Licensees",
    topics: ["Negligence", "Breach of Fiduciary Duty"],
  }];

  test("lists the topics, then exactly the glossary terms it is given and their count, before the human flashcards", async () => {
    const { requests } = await requestWithMessage(createJsonMessage({ flashcards: [] }), { manualChapters });
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;
    assert.match(contextBlock.text, /WHAT THIS CHAPTER COVERS: .* Every flashcard must be for a term or concept from these topics\./);
    assert.match(
      contextBlock.text,
      /Manual chapter 5, The Professional Liability of Real Estate Licensees:\n- Negligence\n- Breach of Fiduciary Duty\n\nCOURSE GLOSSARY TERMS \(2\): [^\n]*that no flashcard in any chapter covers yet[^\n]*\nWarranty of Authority; Agency Contract\n\nHUMAN-WRITTEN FLASHCARDS \(1\)/,
    );
    assert.equal(contextBlock.text.includes("Accelerated Biweekly Payments"), false, "no glossary term it wasn't given");
    assert.match(instructionBlock.text, /It is for a term or concept from the course manual topics listed for this chapter/);
    assert.match(instructionBlock.text, /Prefer a course glossary term that belongs to this chapter and that no card above covers/);
  });

  test("keeps the glossary terms but leaves the topics out for a chapter without manual chapters", async () => {
    const { requests } = await requestWithMessage(createJsonMessage({ flashcards: [] }), { manualChapters: [] });
    const [contextBlock, instructionBlock] = requests[0].messages[0].content;
    assert.equal(contextBlock.text.includes("WHAT THIS CHAPTER COVERS"), false);
    assert.ok(contextBlock.text.includes("COURSE GLOSSARY TERMS"));
    assert.equal(instructionBlock.text.includes("course manual topics"), false);
    assert.match(instructionBlock.text, /Prefer a course glossary term/);
  });

  test("leaves the glossary block and its instruction line out when no glossary term is left", async () => {
    const withTopics = await requestWithMessage(createJsonMessage({ flashcards: [] }), {
      manualChapters,
      glossaryTermsWithoutFlashcard: [],
    });
    const [contextBlock, instructionBlock] = withTopics.requests[0].messages[0].content;
    assert.equal(contextBlock.text.includes("GLOSSARY"), false);
    assert.match(contextBlock.text, /\n- Breach of Fiduciary Duty\n\nHUMAN-WRITTEN FLASHCARDS \(1\)/);
    assert.equal(instructionBlock.text.toLowerCase().includes("glossary"), false);
    assert.match(
      instructionBlock.text,
      /Requirements for each flashcard:\n- It is for a term or concept from the course manual topics listed for this chapter\n- It is for a term or concept that no card above covers/,
    );

    const withoutTopics = await requestWithMessage(createJsonMessage({ flashcards: [] }), {
      manualChapters: [],
      glossaryTermsWithoutFlashcard: [],
    });
    const [bareContextBlock, bareInstructionBlock] = withoutTopics.requests[0].messages[0].content;
    assert.match(bareContextBlock.text, /^Chapter 3: The Professional Liability of Real Estate Licensees\n\nHUMAN-WRITTEN FLASHCARDS \(1\)/);
    assert.match(bareInstructionBlock.text, /Requirements for each flashcard:\n- It is for a term or concept that no card above covers/);
  });
});

// Test helpers: a fake Anthropic client, and messages shaped like the SDK's finished messages. Not a test file: the
// npm test script only runs test/*.test.js.

export const thinkingBlock = { type: "thinking", thinking: "", signature: "sig" };

/**
 * A client whose nth stream(params).finalMessage() resolves to messages[n], recording every params object it's called
 * with. A request beyond the queued messages fails.
 */
export function createFakeAnthropicClient(messages) {
  const requests = [];
  const client = {
    beta: {
      messages: {
        stream: (params) => {
          requests.push(params);
          const requestNumber = requests.length;
          const message = messages[requestNumber - 1];
          return {
            finalMessage: async () => {
              if (!message) throw new Error(`No queued message for request ${requestNumber}`);
              return message;
            },
          };
        },
      },
    },
  };
  return { client, requests };
}

/**
 * A finished message with the given content blocks and stop reason.
 */
export function createMessage(content, { stopReason = "end_turn", stopDetails = null, model = "claude-opus-5-5" } = {}) {
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
 * A finished message whose text block, after a thinking block, is responseObject as JSON.
 */
export function createJsonMessage(responseObject) {
  return createMessage([thinkingBlock, { type: "text", text: JSON.stringify(responseObject) }]);
}

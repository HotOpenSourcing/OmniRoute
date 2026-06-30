import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createTransformer } from "../../../../src/lib/providers/freebuff/stream/index.ts";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function pipe(
  transformer: TransformStream<Uint8Array, Uint8Array>,
  sseInput: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseInput));
      controller.close();
    },
  });

  const out = source.pipeThrough(transformer);
  const reader = out.getReader();
  let result = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

interface SseEvent {
  event: string;
  data: unknown;
}

/** Parse SSE into [{event, data}] pairs. */
function parseSse(sse: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of sse.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) data += line.slice("data:".length).trimStart();
    }
    if (event || data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch {
        events.push({ event, data });
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Event ordering — Chunk 5 acceptance criterion.
// ---------------------------------------------------------------------------

describe("Anthropic transformer — event ordering", () => {
  test("emits message_start, content_block_*, message_delta, message_stop in order", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"hello"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const events = parseSse(out);
    const order = events.map((e) => e.event);
    assert.deepEqual(order, [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  test("message_start carries model + role + usage", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"x"}\n\n',
    );
    const start = parseSse(out).find((e) => e.event === "message_start");
    assert.ok(start);
    const data = start.data as { message: { role: string; model: string; usage: unknown } };
    assert.equal(data.message.role, "assistant");
    assert.equal(data.message.model, "glm-5.2");
    assert.ok(data.message.usage);
  });

  test("text delta uses text_delta type", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"hello"}\n\n',
    );
    const delta = parseSse(out).find((e) => e.event === "content_block_delta");
    assert.ok(delta);
    const d = delta.data as { delta: { type: string; text: string } };
    assert.equal(d.delta.type, "text_delta");
    assert.equal(d.delta.text, "hello");
  });
});

// ---------------------------------------------------------------------------
// Reasoning → thinking blocks.
// ---------------------------------------------------------------------------

describe("Anthropic transformer — reasoning blocks", () => {
  test("opens a thinking block for reasoning_delta", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: reasoning_delta\ndata: {"text":"considering","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const events = parseSse(out);
    const thinkingStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as { content_block: { type: string } }).content_block.type ===
          "thinking",
    );
    assert.ok(thinkingStart);
    const thinkingDelta = events.find(
      (e) =>
        e.event === "content_block_delta" &&
        (e.data as { delta: { type: string } }).delta.type === "thinking_delta",
    );
    assert.ok(thinkingDelta);
    assert.equal(
      (thinkingDelta.data as { delta: { thinking: string } }).delta.thinking,
      "considering",
    );
  });

  test("closes the thinking block before the text block", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: reasoning_delta\ndata: {"text":"t","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n' +
        'event: response-chunk\ndata: {"text":"hello"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const events = parseSse(out);
    const indexes = events.map((e) => ({
      event: e.event,
      type:
        (e.data as { content_block?: { type: string } }).content_block?.type ??
        (e.data as { delta?: { type: string } }).delta?.type ??
        null,
    }));
    const thinkingCloseIdx = indexes.findIndex(
      (x, i) =>
        x.event === "content_block_stop" &&
        indexes
          .slice(0, i)
          .some(
            (y) =>
              y.event === "content_block_start" &&
              y.type === "thinking",
          ) &&
        indexes
          .slice(i + 1)
          .some(
            (y) =>
              y.event === "content_block_start" && y.type === "text",
          ),
    );
    assert.ok(thinkingCloseIdx >= 0, "expected thinking block to close before text block");
  });
});

// ---------------------------------------------------------------------------
// Tool calls → tool_use blocks.
// ---------------------------------------------------------------------------

describe("Anthropic transformer — tool_use blocks", () => {
  test("emits tool_use start/delta/stop for tool-call events", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"read_file","input":{"path":"/x"}}\n\n',
    );
    const events = parseSse(out);
    const toolStart = events.find(
      (e) =>
        e.event === "content_block_start" &&
        (e.data as { content_block: { type: string } }).content_block.type ===
          "tool_use",
    );
    assert.ok(toolStart);
    const block = (toolStart.data as {
      content_block: { id: string; name: string; type: string };
    }).content_block;
    assert.equal(block.type, "tool_use");
    assert.equal(block.id, "tc1");
    assert.equal(block.name, "read_file");

    const inputDelta = events.find(
      (e) =>
        e.event === "content_block_delta" &&
        (e.data as { delta: { type: string } }).delta.type === "input_json_delta",
    );
    assert.ok(inputDelta);
    assert.equal(
      (inputDelta.data as { delta: { partial_json: string } }).delta.partial_json,
      '{"path":"/x"}',
    );
  });

  test("message_delta carries stop_reason: tool_use when tools were called", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"f","input":{}}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const messageDelta = parseSse(out).find((e) => e.event === "message_delta");
    assert.ok(messageDelta);
    assert.equal(
      (messageDelta.data as { delta: { stop_reason: string } }).delta.stop_reason,
      "tool_use",
    );
  });

  test("message_delta carries stop_reason: end_turn for plain text", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const messageDelta = parseSse(out).find((e) => e.event === "message_delta");
    assert.ok(messageDelta);
    assert.equal(
      (messageDelta.data as { delta: { stop_reason: string } }).delta.stop_reason,
      "end_turn",
    );
  });
});

// ---------------------------------------------------------------------------
// Error mapping — Anthropic shape.
// ---------------------------------------------------------------------------

describe("Anthropic transformer — error mapping", () => {
  test("country_blocked becomes a typed error event", async () => {
    const out = await pipe(
      createTransformer("anthropic", { model: "glm-5.2" }),
      'event: prompt-error\ndata: {"code":"country_blocked","message":"raw","countryBlockReason":"FR"}\n\n',
    );
    const error = parseSse(out).find((e) => e.event === "error");
    assert.ok(error);
    const data = error.data as { type: string; error: { type: string; message: string } };
    assert.equal(data.type, "error");
    assert.equal(data.error.type, "country_blocked");
    assert.match(data.error.message, /region/);
    assert.doesNotMatch(data.error.message, /raw/);
  });
});

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

/** Pipe a sequence of byte chunks (string[]) through the transformer. */
async function pipeChunks(
  transformer: TransformStream<Uint8Array, Uint8Array>,
  chunks: string[],
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
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

/** Parse an SSE stream into one entry per `data:` frame. */
function parseSse(sse: string): Array<{ data: unknown }> {
  const frames: Array<{ data: unknown }> = [];
  for (const block of sse.split("\n\n")) {
    if (!block.trim()) continue;
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trimStart();
      if (payload === "") continue;
      try {
        frames.push({ data: JSON.parse(payload) });
      } catch {
        frames.push({ data: payload });
      }
    }
  }
  return frames;
}

/** Standard OpenAI chat.completion.chunk shape used in fixtures. */
interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
}

/** Build a minimal OpenAI chat.completion.chunk frame. */
function chunk(
  partial: Partial<OpenAIChunk> & { delta?: Record<string, unknown>; finish_reason?: string | null },
): string {
  const full: OpenAIChunk = {
    id: partial.id ?? "chatcmpl-test",
    object: "chat.completion.chunk",
    created: partial.created ?? 1700000000,
    model: partial.model ?? "glm-5.2",
    choices: [
      {
        index: 0,
        delta: partial.delta ?? {},
        finish_reason: partial.finish_reason ?? null,
      },
    ],
  };
  return `data: ${JSON.stringify(full)}\n\n`;
}

// ---------------------------------------------------------------------------
// Core contract — the OpenAI transformer is a byte-for-byte passthrough.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — passthrough contract", () => {
  test("relays a single OpenAI chunk byte-for-byte", async () => {
    const input = chunk({ delta: { role: "assistant", content: "hi" } });
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input);
  });

  test("relays multiple chunks in order", async () => {
    const input =
      chunk({ id: "chatcmpl-1", delta: { role: "assistant", content: "hello " } }) +
      chunk({ id: "chatcmpl-2", delta: { content: "world" } }) +
      chunk({ id: "chatcmpl-3", delta: {}, finish_reason: "stop" });
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input);
  });

  test("does not synthesize a role announcement", async () => {
    // Upstream emits a content chunk without a preceding role chunk.
    const input = chunk({ delta: { content: "no role prefix" } });
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input, "passthrough must not prepend a role chunk");
    const frames = parseSse(out);
    assert.equal(frames.length, 1);
  });

  test("does not synthesize a `data:n\\n\\n` done marker", async () => {
    const input = chunk({ delta: { content: "x" } });
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input);
    assert.doesNotMatch(out, /data:n\n\n/, "passthrough must not append the done marker");
  });

  test("does not re-frame Codebuff custom events", async () => {
    // Legacy Codebuff wire format — passthrough must NOT translate these.
    const input =
      'event: response-chunk\ndata: {"text":"hidden"}\n\n' +
      'event: reasoning_delta\ndata: {"text":"thinking"}\n\n' +
      "event: prompt-response\ndata: {}\n\n";
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input, "Codebuff events must pass through unmodified");
  });

  test("does not map error frames to OpenAI error envelopes", async () => {
    // An upstream error chunk in OpenAI shape — passthrough must relay it.
    const input = `data: ${JSON.stringify({
      error: { message: "raw upstream detail", type: "upstream_error" },
    })}\n\n`;
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input);
    // The raw message must NOT be sanitized away by the transformer.
    assert.match(out, /raw upstream detail/);
  });
});

// ---------------------------------------------------------------------------
// Options — `model` and `includeSubagentOutput` are accepted but unused.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — options", () => {
  test("accepts a model option without altering output", async () => {
    const input = chunk({ delta: { content: "x" } });
    const out = await pipe(createTransformer("openai", { model: "mimo-v2.5-pro" }), input);
    assert.equal(out, input);
  });

  test("accepts includeSubagentOutput=true without altering output", async () => {
    const input = chunk({ delta: { content: "x" } });
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2", includeSubagentOutput: true }),
      input,
    );
    assert.equal(out, input);
  });

  test("accepts includeSubagentOutput=false explicitly", async () => {
    const input = chunk({ delta: { content: "x" } });
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2", includeSubagentOutput: false }),
      input,
    );
    assert.equal(out, input);
  });
});

// ---------------------------------------------------------------------------
// Partial chunks — the upstream may split a single SSE frame across reads.
// Passthrough concatenates bytes verbatim, so reassembly is the consumer's
// responsibility; the transformer must not corrupt the byte stream.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — partial chunk handling", () => {
  test("concatenates split chunks into the original byte stream", async () => {
    const input = chunk({ delta: { content: "split" } });
    const midpoint = Math.floor(input.length / 2);
    const out = await pipeChunks(createTransformer("openai", { model: "glm-5.2" }), [
      input.slice(0, midpoint),
      input.slice(midpoint),
    ]);
    assert.equal(out, input);
  });

  test("handles a single-byte-at-a-time trickle", async () => {
    const input = chunk({ delta: { content: "trickle" } });
    const chunks: string[] = [];
    for (let i = 0; i < input.length; i++) chunks.push(input[i]!);
    const out = await pipeChunks(createTransformer("openai", { model: "glm-5.2" }), chunks);
    assert.equal(out, input);
  });

  test("preserves byte boundaries across many small reads", async () => {
    const input =
      chunk({ id: "a", delta: { role: "assistant", content: "alpha" } }) +
      chunk({ id: "b", delta: { content: "beta" } }) +
      chunk({ id: "c", delta: {}, finish_reason: "stop" });
    const chunks: string[] = [];
    // Split every 7 bytes to stress the boundary handling.
    for (let i = 0; i < input.length; i += 7) chunks.push(input.slice(i, i + 7));
    const out = await pipeChunks(createTransformer("openai", { model: "glm-5.2" }), chunks);
    assert.equal(out, input);
  });
});

// ---------------------------------------------------------------------------
// Edge cases.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — edge cases", () => {
  test("empty input produces empty output", async () => {
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), "");
    assert.equal(out, "");
  });

  test("preserves non-UTF8 bytes (binary-safe relay)", async () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const bytes = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x68, 0x69]);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const out = source.pipeThrough(createTransformer("openai", { model: "glm-5.2" }));
    const reader = out.getReader();
    let collected = new Uint8Array(0);
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(collected.length + value!.length);
      next.set(collected, 0);
      next.set(value!, collected.length);
      collected = next;
    }
    // The transformer must NOT mutate the bytes; decoding may produce
    // replacement characters but the byte sequence is preserved.
    assert.equal(collected.length, bytes.length);
    assert.equal(decoder.decode(collected), decoder.decode(bytes));
    // Sanity: the encoder round-trips the bytes identically.
    assert.deepEqual(Array.from(collected), Array.from(bytes));
  });

  test("does not emit a trailing newline or extra whitespace", async () => {
    const input = chunk({ delta: { content: "x" } });
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out.length, input.length);
  });

  test("handles a long stream of chunks", async () => {
    let input = "";
    for (let i = 0; i < 100; i++) {
      input += chunk({ id: `c-${i}`, delta: { content: `tok-${i}` } });
    }
    const out = await pipe(createTransformer("openai", { model: "glm-5.2" }), input);
    assert.equal(out, input);
  });
});

// ---------------------------------------------------------------------------
// Format dispatch — the factory must return a passthrough for "openai".
// ---------------------------------------------------------------------------

describe("createTransformer — format dispatch", () => {
  test("returns a passthrough for the openai format", async () => {
    const transformer = createTransformer("openai", { model: "glm-5.2" });
    // The passthrough contract: any input is relayed verbatim.
    const sample = chunk({ delta: { content: "dispatch-check" } });
    const out = await pipe(transformer, sample);
    assert.equal(out, sample);
  });

  test("throws on an unknown format", () => {
    assert.throws(
      () => createTransformer("bogus" as never, { model: "x" }),
      /Unknown transformer format/,
    );
  });
});

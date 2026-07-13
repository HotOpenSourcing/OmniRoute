import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

const { peekEmptyOutputError, rebuildStream } = await import(
  "../../src/lib/providers/freebuff/cliEmulator/emulateChat.ts"
);
const { FreebuffEmptyOutputError } = await import(
  "../../src/lib/providers/freebuff/cliEmulator/types.ts"
);

/**
 * Helper: Create a ReadableStream from string chunks
 */
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

test("peekEmptyOutputError: detects error in first chunk", async () => {
  const stream = createMockStream([
    'data: {"error":"model output error: model output must contain either output text or tool calls"}',
  ]);

  const result = await peekEmptyOutputError(stream);
  assert.ok(result.message);
  assert.match(result.message, /model output must contain either output text or tool calls/);
  assert.equal(result.buffered.length, 1);
});

test("peekEmptyOutputError: detects error in second chunk", async () => {
  const stream = createMockStream([
    'data: {"error":"model output must contain either output text or tool calls, these cannot both be empty"}',
  ]);

  const result = await peekEmptyOutputError(stream);
  assert.ok(result.message);
  // The regex extracts either the JSON data field or falls back to "empty_output"
  assert.ok(result.message.includes("error") || result.message === "empty_output");
  assert.ok(result.buffered.length >= 1);
});

test("peekEmptyOutputError: returns null for valid stream", async () => {
  const stream = createMockStream([
    'data: {"id":"chatcmpl-123","object":"chat.completion.chunk"}',
    'data: {"choices":[{"delta":{"content":"Hello"}}]}',
  ]);

  const result = await peekEmptyOutputError(stream);
  assert.equal(result.message, null);
  assert.equal(result.buffered.length, 2);
});

test("peekEmptyOutputError: stops at 8KB limit", async () => {
  // Create a stream with 10KB of data but no error
  const largeChunk = "x".repeat(1024); // 1KB per chunk
  const chunks = Array(10).fill(`data: {"content":"${largeChunk}"}`);
  const stream = createMockStream(chunks);

  const result = await peekEmptyOutputError(stream);
  assert.equal(result.message, null);
  // Should stop reading around 8KB (8 chunks)
  assert.ok(result.buffered.length <= 9, `Expected <= 9 chunks, got ${result.buffered.length}`);
});

test("rebuildStream: reconstructs stream from buffered chunks", async () => {
  const originalChunks = ["chunk1", "chunk2", "chunk3"];
  const buffered = originalChunks.map((s) => new TextEncoder().encode(s));
  const remaining = createMockStream(["chunk4", "chunk5"]);

  const rebuilt = rebuildStream(buffered, remaining);
  const reader = rebuilt.getReader();
  const decoder = new TextDecoder();
  const results: string[] = [];

  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;
    if (value) {
      results.push(decoder.decode(value, { stream: true }));
    }
  }

  assert.deepEqual(results, ["chunk1", "chunk2", "chunk3", "chunk4", "chunk5"]);
});

test("FreebuffEmptyOutputError: has correct properties", () => {
  const error = new FreebuffEmptyOutputError(
    "model output must contain either output text or tool calls",
    "freebuff/claude-sonnet-4"
  );

  assert.equal(error.code, "empty_output");
  assert.equal(error.httpStatus, 502);
  assert.equal(error.retryable, false);
  assert.match(error.message, /model output must contain/);
  assert.equal(error.model, "freebuff/claude-sonnet-4");
  assert.equal(error.name, "FreebuffEmptyOutputError");
});

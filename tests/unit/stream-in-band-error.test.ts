import test from "node:test";
import assert from "node:assert/strict";

import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch {
    // Some error-path streams error after emitting the error payload. Collect
    // whatever was already enqueued so assertions can inspect the client-visible
    // SSE frames.
  } finally {
    reader.releaseLock();
  }
  return decoder.decode(
    chunks.length === 1 ? chunks[0] : Uint8Array.from(chunks.flatMap((chunk) => Array.from(chunk)))
  );
}

function sseResponse(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

test("passthrough surfaces Kimchi event:error in-band 503 as an SSE error", async () => {
  let failure: { status: number; message: string } | null = null;

  const upstream = sseResponse(
    'event: error\ndata: {"error":{"code":503,"message":"the provider for model kimi-k2.7 has exhausted its credits and cannot process requests","type":"server_error"}}\n\n'
  );

  const transform = createPassthroughStreamWithLogger(
    "kimchi",
    null,
    null,
    "kimi-k2.7",
    null,
    null,
    null,
    null,
    (payload) => {
      failure = payload;
      return true;
    }
  );

  const output = await readStreamText(upstream.pipeThrough(transform));

  assert.ok(output.includes("exhausted its credits"), "error message must reach client");
  assert.match(output, /data: \{"error":/);
  assert.equal(failure?.status, 503);
  assert.ok(failure?.message.includes("exhausted its credits"));
});

test("passthrough surfaces data:{error} in-band 503 as an SSE error", async () => {
  let failure: { status: number; message: string } | null = null;

  const upstream = sseResponse(
    'data: {"error":{"code":503,"message":"the provider for model minimax-m3 has exhausted its credits and cannot process requests","type":"server_error"}}\n\n'
  );

  const transform = createPassthroughStreamWithLogger(
    "kimchi",
    null,
    null,
    "minimax-m3",
    null,
    null,
    null,
    null,
    (payload) => {
      failure = payload;
      return true;
    }
  );

  const output = await readStreamText(upstream.pipeThrough(transform));

  assert.ok(output.includes("exhausted its credits"), "error message must reach client");
  assert.equal(failure?.status, 503);
});

test("translate mode surfaces in-band error instead of empty completion", async () => {
  let failure: { status: number; message: string } | null = null;

  const upstream = sseResponse(
    'data: {"error":{"code":502,"message":"provider gateway unavailable","type":"server_error"}}\n\n'
  );

  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    "some-provider",
    null,
    null,
    "some-model",
    null,
    { model: "some-model", messages: [{ role: "user", content: "hi" }] },
    null,
    null,
    (payload) => {
      failure = payload;
      return true;
    }
  );

  const output = await readStreamText(upstream.pipeThrough(transform));

  assert.ok(output.includes("gateway unavailable"), "error message must reach client");
  assert.equal(failure?.status, 502);
});

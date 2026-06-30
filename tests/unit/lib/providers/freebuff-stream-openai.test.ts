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

interface OpenAIChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
}

/** Parse an OpenAI SSE stream into one entry per `data:` frame. */
function parseSse(sse: string): Array<{ data: OpenAIChunk | string }> {
  const frames: Array<{ data: OpenAIChunk | string }> = [];
  for (const block of sse.split("\n\n")) {
    if (!block.trim()) continue;
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trimStart();
      if (payload === "") continue;
      try {
        frames.push({ data: JSON.parse(payload) as OpenAIChunk });
      } catch {
        frames.push({ data: payload });
      }
    }
  }
  return frames;
}

function chunkDeltas(frames: Array<{ data: OpenAIChunk | string }>) {
  const out: Array<{ delta: Record<string, unknown>; finish_reason: string | null }> = [];
  for (const f of frames) {
    if (typeof f.data === "object") out.push(f.data.choices[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Frame shape — every chunk is `data: <json>\n\n` with no `event:` line.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — frame shape", () => {
  test("every emitted frame is data-only (no event: line)", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"hello"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    for (const line of out.split("\n")) {
      assert.doesNotMatch(line, /^event:/, "OpenAI format must not use event: lines");
    }
  });

  test("chunk object fields are chat.completion.chunk with model stamped", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "minimax-m3" }),
      'event: response-chunk\ndata: {"text":"hi"}\n\n',
    );
    const frames = parseSse(out);
    const chunk = frames.find((f) => typeof f.data === "object")!.data as OpenAIChunk;
    assert.equal(chunk.object, "chat.completion.chunk");
    assert.equal(chunk.model, "minimax-m3");
    assert.equal(chunk.choices[0].index, 0);
    assert.match(chunk.id, /^chatcmpl-/);
    assert.equal(typeof chunk.created, "number");
    assert.ok(chunk.created > 0);
  });
});

// ---------------------------------------------------------------------------
// Lazy role announcement — chunk 5 acceptance criterion.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — role announcement", () => {
  test("emits the role delta exactly once, before the first non-empty content", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"a"}\n\n' +
        'event: response-chunk\ndata: {"text":"b"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const roles = deltas.filter((d) => d.delta.role === "assistant");
    assert.equal(roles.length, 1, "role should be announced exactly once");
    assert.equal(roles[0].delta.content, "");
  });

  test("first content delta arrives in the same chunk as the role announcement", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"hello"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const first = deltas[0];
    assert.equal(first.delta.role, "assistant");
    assert.equal(first.delta.content, "hello");
  });

  test("concatenating all content deltas reconstructs the source text", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"hello "}\n\n' +
        'event: response-chunk\ndata: {"text":"world"}\n\n',
    );
    const text = chunkDeltas(parseSse(out))
      .map((d) => d.delta.content ?? "")
      .join("");
    assert.equal(text, "hello world");
  });
});

// ---------------------------------------------------------------------------
// Response chunks → delta.content.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — response chunks", () => {
  test("emits a delta.content frame for each response-chunk event", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"abc"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const content = deltas.find((d) => typeof d.delta.content === "string");
    assert.ok(content);
    assert.equal(content!.delta.content, "abc");
    assert.equal(content!.finish_reason, null);
  });

  test("empty text is dropped silently (no chunk emitted)", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":""}\n\n' +
        'event: response-chunk\ndata: {"text":"x"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const content = deltas.map((d) => d.delta.content ?? "");
    assert.deepEqual(content, ["x"]);
  });
});

// ---------------------------------------------------------------------------
// Reasoning → delta.reasoning_content.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — reasoning chunks", () => {
  test("emits delta.reasoning_content for reasoning_delta events", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: reasoning_delta\ndata: {"text":"thinking","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const reasoning = deltas.find((d) => typeof d.delta.reasoning_content === "string");
    assert.ok(reasoning);
    assert.equal(reasoning!.delta.reasoning_content, "thinking");
  });

  test("reasoning precedes text content in the output", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: reasoning_delta\ndata: {"text":"t","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n' +
        'event: response-chunk\ndata: {"text":"hello"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const order = deltas.map((d) =>
      typeof d.delta.reasoning_content === "string"
        ? "reasoning"
        : typeof d.delta.content === "string"
          ? "content"
          : "other",
    );
    assert.deepEqual(order, ["reasoning", "content"]);
  });

  test("empty reasoning text is dropped silently", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: reasoning_delta\ndata: {"text":"","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    assert.equal(deltas.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tool calls → delta.tool_calls[].
// ---------------------------------------------------------------------------

describe("OpenAI transformer — tool calls", () => {
  test("emits delta.tool_calls with id/type/function name and stringified arguments", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"read_file","input":{"path":"/x"}}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const toolChunk = deltas.find((d) => Array.isArray(d.delta.tool_calls));
    assert.ok(toolChunk);
    const tc = (toolChunk!.delta.tool_calls as Array<Record<string, unknown>>)[0];
    assert.equal(tc.id, "tc1");
    assert.equal(tc.type, "function");
    const fn = tc.function as { name: string; arguments: string };
    assert.equal(fn.name, "read_file");
    assert.equal(fn.arguments, '{"path":"/x"}');
  });

  test("string input is passed through verbatim", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"echo","input":"raw text"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const tc = (deltas[0].delta.tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as { name: string; arguments: string };
    assert.equal(fn.arguments, "raw text");
  });

  test("undefined input becomes empty arguments string", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"ping"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const tc = (deltas[0].delta.tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as { name: string; arguments: string };
    assert.equal(fn.arguments, "");
  });

  test("terminating chunk carries finish_reason: tool_calls after a tool call", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"f","input":{}}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const deltas = chunkDeltas(parseSse(out));
    const tail = deltas[deltas.length - 1];
    assert.equal(tail.finish_reason, "tool_calls");
    assert.deepEqual(tail.delta, {});
  });

  test("terminating chunk carries finish_reason: stop after plain text", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"done"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const deltas = chunkDeltas(parseSse(out));
    const tail = deltas[deltas.length - 1];
    assert.equal(tail.finish_reason, "stop");
    assert.deepEqual(tail.delta, {});
  });
});

// ---------------------------------------------------------------------------
// Subagent output — gated by includeSubagentOutput.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — subagent chunks", () => {
  test("are dropped silently when includeSubagentOutput is false (default)", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: subagent-response-chunk\ndata: {"agentId":"a1","text":"hidden"}\n\n' +
        'event: response-chunk\ndata: {"text":"visible"}\n\n',
    );
    const text = chunkDeltas(parseSse(out))
      .map((d) => d.delta.content ?? "")
      .join("");
    assert.equal(text, "visible");
  });

  test("are emitted as bracketed content when includeSubagentOutput is true", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2", includeSubagentOutput: true }),
      'event: subagent-response-chunk\ndata: {"agentId":"a1","text":"note"}\n\n',
    );
    const deltas = chunkDeltas(parseSse(out));
    const text = deltas.map((d) => d.delta.content ?? "").join("");
    assert.equal(text, "[sub-agent:a1] note");
  });
});

// ---------------------------------------------------------------------------
// Error mapping — OpenAI shape.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — error mapping", () => {
  test("country_blocked becomes a typed error frame with friendly message", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: prompt-error\ndata: {"code":"country_blocked","message":"raw","countryBlockReason":"FR"}\n\n',
    );
    const frames = parseSse(out);
    const err = frames.find((f) => typeof f.data === "object" && "error" in f.data);
    assert.ok(err);
    const data = err.data as unknown as {
      error: { type: string; message: string; code: string };
    };
    assert.equal(data.error.type, "country_blocked");
    assert.match(data.error.message, /region/);
    assert.doesNotMatch(data.error.message, /raw/);
  });

  test("rate_limited maps to a friendly hint without leaking the raw message", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: prompt-error\ndata: {"code":"rate_limited","message":"internal stack 0xdeadbeef"}\n\n',
    );
    const frames = parseSse(out);
    const err = frames.find((f) => typeof f.data === "object" && "error" in f.data);
    assert.ok(err);
    const data = err.data as unknown as { error: { type: string; message: string } };
    assert.match(data.error.message, /rate limit/i);
    assert.doesNotMatch(data.error.message, /stack|0xdeadbeef/);
  });

  test("unauthenticated maps to a re-auth hint", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: prompt-error\ndata: {"code":"unauthenticated","message":"expired"}\n\n',
    );
    const frames = parseSse(out);
    const err = frames.find((f) => typeof f.data === "object" && "error" in f.data);
    const data = err!.data as unknown as { error: { message: string } };
    assert.match(data.error.message, /authenticate|re-auth/i);
  });

  test("error frame is immediately followed by the done marker", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: prompt-error\ndata: {"code":"country_blocked","message":"x","countryBlockReason":"DE"}\n\n',
    );
    assert.match(out, /data:n\n\n$/, "stream should terminate with `data: n` after an error");
  });
});

// ---------------------------------------------------------------------------
// Termination — `data: n\n\n` sentinel.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — stream termination", () => {
  test("plain text run ends with `data: n\\n\\n`", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"done"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    assert.match(out, /data:n\n\n$/);
  });

  test("tool-call run also ends with `data: n\\n\\n`", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"f","input":{}}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    assert.match(out, /data:n\n\n$/);
  });

  test("no frames are emitted after the done marker", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n" +
        'event: response-chunk\ndata: {"text":"should-not-appear"}\n\n',
    );
    const after = out.slice(out.lastIndexOf("data:n\n\n"));
    assert.equal(after, "data:n\n\n");
  });

  test("a run with no content at all still emits the done marker", async () => {
    const out = await pipe(
      createTransformer("openai", { model: "glm-5.2" }),
      "event: prompt-response\ndata: {}\n\n",
    );
    assert.match(out, /data:n\n\n$/);
  });
});

// ---------------------------------------------------------------------------
// Streaming behaviour — multi-chunk input.
// ---------------------------------------------------------------------------

describe("OpenAI transformer — streaming", () => {
  test("handles partial chunks split across transform boundaries", async () => {
    const transformer = createTransformer("openai", { model: "glm-5.2" });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // The first byte buffer ends mid-event; the second finishes it.
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: response-chunk\ndata: {"tex'));
        controller.enqueue(encoder.encode('t":"split"}\n\n'));
        controller.enqueue(encoder.encode("event: prompt-response\ndata: {}\n\n"));
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

    const text = chunkDeltas(parseSse(result))
      .map((d) => d.delta.content ?? "")
      .join("");
    assert.equal(text, "split");
    assert.match(result, /data:n\n\n$/);
  });

  test("the upstream closes after prompt-error (no further events processed)", async () => {
    const transformer = createTransformer("openai", { model: "glm-5.2" });
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: prompt-error\ndata: {"code":"country_blocked","message":"x","countryBlockReason":"DE"}\n\n' +
              'event: response-chunk\ndata: {"text":"should-be-dropped"}\n\n',
          ),
        );
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

    const text = chunkDeltas(parseSse(result))
      .map((d) => d.delta.content ?? "")
      .join("");
    assert.equal(text, "", "no content should reach the client after a prompt-error");
    assert.match(result, /country_blocked/);
  });
});

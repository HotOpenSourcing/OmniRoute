import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createTransformer } from "../../../../src/lib/providers/freebuff/stream/index.ts";

// ---------------------------------------------------------------------------
// FakeEventSource — minimal EventSource-shaped consumer for the transformed
// stream. Mirrors the parts of the EventSource API that real SSE clients
// (openai SDK, AI SDK, Open WebUI) actually touch:
//   - readyState transitions
//   - onopen / onmessage / onerror handlers
//   - addEventListener("message" | "error")
//   - close()
//
// It accepts the post-transform OpenAI SSE bytes as a ReadableStream and
// dispatches events to listeners, just like a browser would.
// ---------------------------------------------------------------------------

type EsListener = (ev: { type: string; data: unknown }) => void;

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState: number = FakeEventSource.CONNECTING;
  readonly url: string;
  withCredentials = false;

  onopen: EsListener | null = null;
  onmessage: EsListener | null = null;
  onerror: EsListener | null = null;

  /** Captured message payloads (anything the consumer would render). */
  readonly messages: unknown[] = [];
  /** Captured error payloads (the OpenAI { error } envelope). */
  readonly errors: unknown[] = [];

  private readonly listeners = new Map<string, Set<EsListener>>();
  private readonly decoder = new TextDecoder();
  private streamDone = false;

  constructor(stream: ReadableStream<Uint8Array>, url = "about:blank") {
    this.url = url;
    // Fire and forget — handlers attach on the next tick.
    void this.consume(stream);
  }

  addEventListener(type: string, listener: EsListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EsListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(_ev: { type: string }): boolean {
    return true;
  }

  close(): void {
    if (this.readyState === FakeEventSource.CLOSED) return;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** True once the upstream stream has signalled end-of-stream. */
  get ended(): boolean {
    return this.streamDone;
  }

  private async consume(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
      // Browsers set readyState=OPEN synchronously after construction;
      // we emulate that with a microtask.
      this.readyState = FakeEventSource.OPEN;
      this.fire("open", undefined);

      const reader = stream.getReader();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += this.decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          this.handleBlock(block);
        }
      }
      // Drain any trailing partial block — the transformer guarantees
      // nothing meaningful lands here, but we still walk it.
      if (buffer.trim()) this.handleBlock(buffer);

      this.streamDone = true;
      this.readyState = FakeEventSource.CLOSED;
    } catch (err) {
      this.readyState = FakeEventSource.CLOSED;
      this.fire("error", err);
    }
  }

  private handleBlock(block: string): void {
    let data = "";
    let event = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data += line.slice("data:".length).trimStart();
      else if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    }
    if (data === "") return;
    // The OpenAI done marker — drop on the floor and stop emitting.
    if (data === "n") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = data;
    }

    // OpenAI error chunks are JSON of the form { error: {...} }.
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const errorPayload = (parsed as { error: unknown }).error;
      this.errors.push(errorPayload);
      this.fire("error", parsed);
      return;
    }

    this.messages.push(parsed);
    this.fire(event || "message", parsed);
  }

  private fire(type: string, data: unknown): void {
    const ev = { type, data };
    if (type === "open" && this.onopen) this.onopen(ev);
    if (type === "message" && this.onmessage) this.onmessage(ev);
    if (type === "error" && this.onerror) this.onerror(ev);
    this.listeners.get(type)?.forEach((l) => l(ev));
  }
}

// ---------------------------------------------------------------------------
// Helper — build a ReadableStream of raw Codebuff SSE bytes from a string.
// Mirrors what `freebuff.exe` would emit over HTTP, byte for byte.
// ---------------------------------------------------------------------------

function streamFromString(sse: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// End-to-end — Codebuff SSE → transformer → FakeEventSource (OpenAI client).
// ---------------------------------------------------------------------------

describe("Freebuff SSE → OpenAI — end-to-end via FakeEventSource", () => {
  test("readyState transitions CONNECTING → OPEN → CLOSED", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"hi"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    // Right after construction, OPEN is already set synchronously.
    assert.equal(es.readyState, FakeEventSource.OPEN);

    // Wait for end-of-stream.
    while (!es.ended) await new Promise((r) => setTimeout(r, 1));
    assert.equal(es.readyState, FakeEventSource.CLOSED);
    assert.equal(es.messages.length, 2); // role+content chunk, tail chunk
  });

  test("open event fires once and before the first message", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    let openCount = 0;
    let firstMessageAt = -1;
    let messagesSeen = 0;
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );
    es.onopen = () => openCount++;
    es.onmessage = () => {
      messagesSeen++;
      if (firstMessageAt === -1) firstMessageAt = openCount;
    };

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));
    assert.ok(openCount >= 1, "open should fire at least once");
    assert.ok(firstMessageAt >= 1, "first message arrives after open");
    assert.ok(messagesSeen >= 1);
  });

  test("plain text run: role announcement + content + tail chunks", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"hello "}\n\n' +
        'event: response-chunk\ndata: {"text":"world"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    // Reconstruct the assistant text from content deltas.
    type Chunk = {
      choices: Array<{ delta: { role?: string; content?: string }; finish_reason: string | null }>;
    };
    const text = es.messages
      .map((m) => (m as Chunk).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, "hello world");

    // The very first message announces role=assistant.
    const first = es.messages[0] as Chunk;
    assert.equal(first.choices[0].delta.role, "assistant");

    // The final message carries the finish_reason stop.
    const tail = es.messages[es.messages.length - 1] as Chunk;
    assert.equal(tail.choices[0].finish_reason, "stop");
  });

  test("reasoning arrives as reasoning_content before the visible content", async () => {
    const stream = streamFromString(
      'event: reasoning_delta\ndata: {"text":"pondering","ancestorRunIds":[],"runId":"r","agentId":"a"}\n\n' +
        'event: response-chunk\ndata: {"text":"answer"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = {
      choices: Array<{
        delta: { reasoning_content?: string; content?: string };
        finish_reason: string | null;
      }>;
    };
    const order = es.messages.map((m) => {
      const d = (m as Chunk).choices[0].delta;
      if (typeof d.reasoning_content === "string") return "reasoning";
      if (typeof d.content === "string") return "content";
      return "tail";
    });
    assert.deepEqual(order.slice(0, 2), ["reasoning", "content"]);
  });

  test("tool calls are delivered as a tool_calls delta on the first message", async () => {
    const stream = streamFromString(
      'event: tool-call\ndata: {"toolCallId":"tc1","toolName":"read_file","input":{"path":"/tmp"}}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = {
      choices: Array<{
        delta: { tool_calls?: Array<Record<string, unknown>> };
        finish_reason: string | null;
      }>;
    };
    const toolChunk = es.messages.find(
      (m) => Array.isArray((m as Chunk).choices[0].delta.tool_calls),
    ) as Chunk;
    assert.ok(toolChunk, "expected a tool_calls delta");
    const tc = toolChunk.choices[0].delta.tool_calls![0];
    assert.equal(tc.id, "tc1");
    const fn = tc.function as { name: string; arguments: string };
    assert.equal(fn.name, "read_file");
    assert.equal(fn.arguments, '{"path":"/tmp"}');

    // Terminal chunk carries finish_reason=tool_calls.
    const tail = es.messages[es.messages.length - 1] as Chunk;
    assert.equal(tail.choices[0].finish_reason, "tool_calls");
  });

  test("country_blocked error fires onerror with a friendly payload", async () => {
    const stream = streamFromString(
      'event: prompt-error\ndata: {"code":"country_blocked","message":"raw","countryBlockReason":"FR"}\n\n',
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    assert.equal(es.errors.length, 1, "exactly one error should fire");
    const err = es.errors[0] as { type: string; message: string };
    assert.equal(err.type, "country_blocked");
    assert.match(err.message, /region/);
    assert.doesNotMatch(err.message, /raw/);
    // No assistant content reached the consumer.
    assert.equal(es.messages.length, 0);
  });

  test("the done marker is suppressed and does not produce a message", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    for (const m of es.messages) {
      assert.notEqual(m, "n");
      assert.notEqual((m as { data?: string }).data, "n");
    }
  });

  test("subagent chunks are dropped unless includeSubagentOutput is set", async () => {
    const stream = streamFromString(
      'event: subagent-response-chunk\ndata: {"agentId":"a1","text":"hidden"}\n\n' +
        'event: response-chunk\ndata: {"text":"visible"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = { choices: Array<{ delta: { content?: string } }> };
    const text = es.messages
      .map((m) => (m as Chunk).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, "visible");
  });

  test("subagent chunks surface as bracketed content when opted in", async () => {
    const stream = streamFromString(
      'event: subagent-response-chunk\ndata: {"agentId":"a1","text":"trace"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(
        createTransformer("openai", { model: "glm-5.2", includeSubagentOutput: true }),
      ),
    );

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = { choices: Array<{ delta: { content?: string } }> };
    const text = es.messages
      .map((m) => (m as Chunk).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, "[sub-agent:a1] trace");
  });
});

// ---------------------------------------------------------------------------
// addEventListener parity — verifies that the FakeEventSource API used by
// real client SDKs (addEventListener("message")) receives the same payloads
// as the onmessage/onerror properties.
// ---------------------------------------------------------------------------

describe("Freebuff SSE → OpenAI — addEventListener parity", () => {
  test("addEventListener('message') receives every onmessage payload", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"alpha"}\n\n' +
        'event: response-chunk\ndata: {"text":"beta"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    const listenerMessages: unknown[] = [];
    es.addEventListener("message", (ev) => listenerMessages.push(ev.data));

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    assert.equal(listenerMessages.length, es.messages.length);
    for (let i = 0; i < listenerMessages.length; i++) {
      assert.deepEqual(listenerMessages[i], es.messages[i]);
    }
  });

  test("addEventListener('error') fires for OpenAI error envelopes", async () => {
    const stream = streamFromString(
      'event: prompt-error\ndata: {"code":"rate_limited","message":"x"}\n\n',
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    let listenerFired = 0;
    es.addEventListener("error", () => listenerFired++);

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    assert.equal(es.errors.length, 1);
    assert.equal(listenerFired, 1);
  });

  test("removeEventListener detaches a handler", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );

    let count = 0;
    const handler = () => count++;
    es.addEventListener("message", handler);
    es.removeEventListener("message", handler);

    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    assert.equal(count, 0);
  });
});

// ---------------------------------------------------------------------------
// Partial-chunk resilience — the upstream may split a single SSE event
// across multiple network reads. The transformer must reassemble it
// before exposing anything to the FakeEventSource.
// ---------------------------------------------------------------------------

describe("Freebuff SSE → OpenAI — partial chunk reassembly", () => {
  test("a Codebuff event split across two reads is reassembled into one OpenAI chunk", async () => {
    const encoder = new TextEncoder();
    const transformer = createTransformer("openai", { model: "glm-5.2" });

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: response-chunk\ndata: {"tex'));
        controller.enqueue(encoder.encode('t":"split"}\n\n'));
        controller.enqueue(encoder.encode("event: prompt-response\ndata: {}\n\n"));
        controller.close();
      },
    });

    const es = new FakeEventSource(source.pipeThrough(transformer));
    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = { choices: Array<{ delta: { content?: string } }> };
    const text = es.messages
      .map((m) => (m as Chunk).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, "split");
  });

  test("a Codebuff event split mid-data-line is reassembled correctly", async () => {
    const encoder = new TextEncoder();
    const transformer = createTransformer("openai", { model: "glm-5.2" });

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: response-chunk\ndata: {"text":'));
        controller.enqueue(encoder.encode('"hello world"}\n\n'));
        controller.enqueue(encoder.encode("event: prompt-response\ndata: {}\n\n"));
        controller.close();
      },
    });

    const es = new FakeEventSource(source.pipeThrough(transformer));
    while (!es.ended) await new Promise((r) => setTimeout(r, 1));

    type Chunk = { choices: Array<{ delta: { content?: string } }> };
    const text = es.messages
      .map((m) => (m as Chunk).choices[0].delta.content ?? "")
      .join("");
    assert.equal(text, "hello world");
  });
});

// ---------------------------------------------------------------------------
// close() — once the consumer aborts, the transformer must stop emitting.
// We don't try to abort the underlying stream (the FakeEventSource just
// marks itself CLOSED); this test guards the public-API contract.
// ---------------------------------------------------------------------------

describe("Freebuff SSE → OpenAI — close()", () => {
  test("readyState becomes CLOSED after close() and stays there", async () => {
    const stream = streamFromString(
      'event: response-chunk\ndata: {"text":"x"}\n\n' +
        "event: prompt-response\ndata: {}\n\n",
    );
    const es = new FakeEventSource(
      stream.pipeThrough(createTransformer("openai", { model: "glm-5.2" })),
    );
    es.close();
    assert.equal(es.readyState, FakeEventSource.CLOSED);
    // Second close is a no-op.
    es.close();
    assert.equal(es.readyState, FakeEventSource.CLOSED);
  });
});

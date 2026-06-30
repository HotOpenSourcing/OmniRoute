import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  codebuffEventSchema,
  parseCodebuffEvent,
  safeParseCodebuffEvent,
  reasoningDeltaEventSchema,
  toolCallEventSchema,
  toolCallRequestEventSchema,
  subagentResponseChunkEventSchema,
  responseChunkEventSchema,
  promptErrorEventSchema,
  promptResponseEventSchema,
  type CodebuffEvent,
} from "../../../../src/lib/providers/freebuff/events.ts";

// ---------------------------------------------------------------------------
// Confirmed-from-binary: reasoning_delta.
// ---------------------------------------------------------------------------

describe("reasoning_delta event (confirmed from binary)", () => {
  test("accepts the wire shape observed in freebuff.exe", () => {
    const event = parseCodebuffEvent({
      type: "reasoning_delta",
      text: "Let me think about this…",
      ancestorRunIds: ["11111111-1111-1111-1111-111111111111"],
      runId: "22222222-2222-2222-2222-222222222222",
      agentId: "base2",
    });
    assert.equal(event.type, "reasoning_delta");
    assert.equal(event.text, "Let me think about this…");
    assert.equal(event.runId, "22222222-2222-2222-2222-222222222222");
    assert.equal(event.agentId, "base2");
  });

  test("rejects missing required fields", () => {
    assert.throws(() =>
      reasoningDeltaEventSchema.parse({
        type: "reasoning_delta",
        text: "x",
        ancestorRunIds: [],
        // missing runId and agentId
      }),
    );
  });

  test("round-trips through JSON serialisation", () => {
    const original = {
      type: "reasoning_delta" as const,
      text: "hello",
      ancestorRunIds: ["33333333-3333-3333-3333-333333333333"],
      runId: "44444444-4444-4444-4444-444444444444",
      agentId: "base2",
    };
    const event = parseCodebuffEvent(original);
    const serialised = JSON.parse(JSON.stringify(event));
    assert.deepEqual(serialised, original);
  });
});

// ---------------------------------------------------------------------------
// Confirmed-from-binary: tool-call uses toolCallId/toolName/input (NOT
// the spec's id/name/arguments — this was a spec error).
// ---------------------------------------------------------------------------

describe("tool-call event (confirmed from binary)", () => {
  test("accepts the wire shape with toolCallId/toolName/input", () => {
    const event = parseCodebuffEvent({
      type: "tool-call",
      toolCallId: "tc-1",
      toolName: "read_file",
      input: { path: "/etc/hostname" },
      contents: "<result>…</result>",
    });
    assert.equal(event.type, "tool-call");
    assert.equal(event.toolCallId, "tc-1");
    assert.equal(event.toolName, "read_file");
    assert.deepEqual(event.input, { path: "/etc/hostname" });
  });

  test("accepts the spec-derived tool-call-request alias", () => {
    const event = parseCodebuffEvent({
      type: "tool-call-request",
      id: "tc-2",
      name: "write_file",
      arguments: { path: "/tmp/x", content: "hi" },
    });
    // Normalised to the binary shape.
    assert.equal(event.type, "tool-call");
    assert.equal(event.toolCallId, "tc-2");
    assert.equal(event.toolName, "write_file");
    assert.deepEqual(event.input, { path: "/tmp/x", content: "hi" });
  });

  test("rejects a tool-call with the spec's wrong field names", () => {
    assert.throws(() =>
      toolCallEventSchema.parse({
        type: "tool-call",
        id: "tc-3",
        name: "read_file",
        arguments: {},
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Spec-derived: response-chunk.
// ---------------------------------------------------------------------------

describe("response-chunk event (spec-derived)", () => {
  test("accepts a wrapped event", () => {
    const event = parseCodebuffEvent({ type: "response-chunk", text: "Hi" });
    assert.equal(event.type, "response-chunk");
    assert.equal(event.text, "Hi");
  });

  test("accepts a raw string (binary-observed shape)", () => {
    const event = parseCodebuffEvent("Just plain text");
    assert.equal(event.type, "response-chunk");
    assert.equal(event.text, "Just plain text");
  });

  test("rejects an object without text", () => {
    assert.throws(() => responseChunkEventSchema.parse({ type: "response-chunk" }));
  });
});

// ---------------------------------------------------------------------------
// Spec-derived: subagent-response-chunk.
// ---------------------------------------------------------------------------

describe("subagent-response-chunk event (spec-derived)", () => {
  test("accepts the spec shape", () => {
    const event = parseCodebuffEvent({
      type: "subagent-response-chunk",
      agentId: "sub-1",
      text: "sub-agent output",
    });
    assert.equal(event.type, "subagent-response-chunk");
    assert.equal(event.agentId, "sub-1");
    assert.equal(event.text, "sub-agent output");
  });

  test("rejects missing agentId", () => {
    assert.throws(() =>
      subagentResponseChunkEventSchema.parse({
        type: "subagent-response-chunk",
        text: "x",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Spec-derived: prompt-response.
// ---------------------------------------------------------------------------

describe("prompt-response event (spec-derived)", () => {
  test("accepts the bare marker string", () => {
    const event = parseCodebuffEvent("prompt-response");
    assert.equal(event.type, "prompt-response");
  });

  test("accepts null as end-of-stream", () => {
    const event = parseCodebuffEvent(null);
    assert.equal(event.type, "prompt-response");
  });

  test("accepts an object form", () => {
    const event = parseCodebuffEvent({ type: "prompt-response" });
    assert.equal(event.type, "prompt-response");
  });
});

// ---------------------------------------------------------------------------
// Spec-derived: prompt-error (country_blocked path is critical).
// ---------------------------------------------------------------------------

describe("prompt-error event (spec-derived)", () => {
  test("accepts a spec-shaped country_blocked error", () => {
    const event = parseCodebuffEvent({
      type: "prompt-error",
      message: "Blocked for region FR",
      code: "country_blocked",
      countryBlockReason: "FR",
    });
    assert.equal(event.type, "prompt-error");
    assert.equal(event.countryBlockReason, "FR");
  });

  test("accepts a binary-shaped error without explicit type", () => {
    const event = parseCodebuffEvent({
      message: "Server unreachable",
    });
    assert.equal(event.type, "prompt-error");
    assert.equal(event.message, "Server unreachable");
  });

  test("rejects an error without message", () => {
    assert.throws(() =>
      promptErrorEventSchema.parse({ type: "prompt-error" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Parser error handling.
// ---------------------------------------------------------------------------

describe("parseCodebuffEvent error handling", () => {
  test("throws on numbers", () => {
    assert.throws(() => parseCodebuffEvent(42));
  });

  test("throws on objects with unrecognised shape", () => {
    assert.throws(() => parseCodebuffEvent({ foo: "bar" }));
  });

  test("safeParseCodebuffEvent returns ok:false on invalid input", () => {
    const result = safeParseCodebuffEvent({ foo: "bar" });
    assert.equal(result.ok, false);
  });

  test("safeParseCodebuffEvent returns ok:true on valid input", () => {
    const result = safeParseCodebuffEvent({
      type: "prompt-response",
    });
    assert.equal(result.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Discriminated union round-trip.
// ---------------------------------------------------------------------------

describe("codebuffEventSchema discriminated union", () => {
  test("accepts every event type as the canonical form", () => {
    const samples: CodebuffEvent[] = [
      {
        type: "reasoning_delta",
        text: "x",
        ancestorRunIds: ["55555555-5555-5555-5555-555555555555"],
        runId: "66666666-6666-6666-6666-666666666666",
        agentId: "base2",
      },
      { type: "response-chunk", text: "x" },
      {
        type: "subagent-response-chunk",
        agentId: "sub",
        text: "x",
      },
      {
        type: "tool-call",
        toolCallId: "x",
        toolName: "x",
        input: {},
      },
      { type: "prompt-response" },
      { type: "prompt-error", message: "x" },
    ];
    for (const sample of samples) {
      assert.deepEqual(codebuffEventSchema.parse(sample), sample);
    }
  });
});

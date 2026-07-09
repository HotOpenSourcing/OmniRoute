import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CodebuffSseParser, parseSseStream } from "@/lib/providers/freebuff/cliEmulator/sseParser";
import {
  buildFallbackChain,
  classifyError,
  nextCandidate,
  type FallbackCandidate,
} from "@/lib/providers/freebuff/cliEmulator/fallbackChain";
import {
  FreebuffAuthError,
  FreebuffCountryBlockedError,
  FreebuffInvalidAgentModelError,
  FreebuffSessionError,
} from "@/lib/providers/freebuff/cliEmulator/types";

describe("CodebuffSseParser", () => {
  it("parses single frames correctly", () => {
    const raw = 'event: response-chunk\ndata: {"text":"hello"}\n\n';
    const events = parseSseStream(raw);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: "response-chunk", text: "hello" });
  });

  it("buffers partial chunks across push calls", () => {
    const parser = new CodebuffSseParser();
    const events1 = parser.push("event: response-");
    assert.equal(events1.length, 0);

    const events2 = parser.push('chunk\ndata: {"text":"part1"}\n\nevent: response-ch');
    assert.equal(events2.length, 1);
    assert.deepEqual(events2[0], { type: "response-chunk", text: "part1" });

    const events3 = parser.push('unk\ndata: {"text":"part2"}\n\n');
    assert.equal(events3.length, 1);
    assert.deepEqual(events3[0], { type: "response-chunk", text: "part2" });
  });

  it("flushes trailing partial frames on flush()", () => {
    const parser = new CodebuffSseParser();
    const events1 = parser.push('event: response-chunk\ndata: {"text":"trail"}');
    assert.equal(events1.length, 0);

    const events2 = parser.flush();
    assert.equal(events2.length, 1);
    assert.deepEqual(events2[0], { type: "response-chunk", text: "trail" });

    // Subsequent flushes should yield nothing.
    const events3 = parser.flush();
    assert.equal(events3.length, 0);
  });

  it("ignores comment lines", () => {
    const raw = ': this is a comment\nevent: response-chunk\n: another comment\ndata: {"text":"hello"}\n\n';
    const events = parseSseStream(raw);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: "response-chunk", text: "hello" });
  });

  it("parses various codebuff event types", () => {
    const raw =
      'event: response-chunk\ndata: {"text":"chunk"}\n\n' +
      'event: reasoning_delta\ndata: {"text":"thinking","ancestorRunIds":["550e8400-e29b-41d4-a716-446655440000"],"runId":"550e8400-e29b-41d4-a716-446655440000","agentId":"ag-1"}\n\n' +
      'event: subagent-response-chunk\ndata: {"agentId":"sa-1","text":"subchunk"}\n\n' +
      'event: prompt-error\ndata: {"message":"failed"}\n\n';

    const events = parseSseStream(raw);
    assert.equal(events.length, 4);
    assert.deepEqual(events[0], { type: "response-chunk", text: "chunk" });
    assert.deepEqual(events[1], {
      type: "reasoning_delta",
      text: "thinking",
      ancestorRunIds: ["550e8400-e29b-41d4-a716-446655440000"],
      runId: "550e8400-e29b-41d4-a716-446655440000",
      agentId: "ag-1",
    });
    assert.deepEqual(events[2], {
      type: "subagent-response-chunk",
      agentId: "sa-1",
      text: "subchunk",
    });
    assert.deepEqual(events[3], {
      type: "prompt-error",
      message: "failed",
      code: undefined,
      countryBlockReason: undefined,
    });
  });
});

describe("fallbackChain", () => {
  describe("classifyError", () => {
    it("classifies FreebuffAuthError as abort", () => {
      const err = new FreebuffAuthError("unauthorized");
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "abort", reason: "authentication required" });
    });

    it("classifies FreebuffCountryBlockedError as downgrade-tier", () => {
      const err = new FreebuffCountryBlockedError("banned", "FR");
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "downgrade-tier", reason: "country blocked: FR" });
    });

    it("classifies FreebuffInvalidAgentModelError as next-model", () => {
      const err = new FreebuffInvalidAgentModelError("message", "some-agent", "some-model");
      const decision = classifyError(err);
      assert.deepEqual(decision, {
        action: "next-model",
        reason: "invalid agent/model: some-agent/some-model",
      });
    });

    it("classifies FreebuffSessionError 401/403 as abort", () => {
      const err = new FreebuffSessionError("token expired", 401);
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "abort", reason: "auth error: 401" });
    });

    it("classifies FreebuffSessionError 429 as retry-same", () => {
      const err = new FreebuffSessionError("too many requests", 429);
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "retry-same", reason: "rate limited" });
    });

    it("classifies FreebuffSessionError 500 as retry-same", () => {
      const err = new FreebuffSessionError("internal server error", 500);
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "retry-same", reason: "upstream 500" });
    });

    it("classifies other FreebuffSessionError as next-model", () => {
      const err = new FreebuffSessionError("bad request", 400);
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "next-model", reason: "session error: 400" });
    });

    it("classifies unknown generic errors as next-model", () => {
      const err = new Error("something went wrong");
      const decision = classifyError(err);
      assert.deepEqual(decision, { action: "next-model", reason: "unknown: something went wrong" });
    });
  });

  describe("buildFallbackChain", () => {
    it("builds premium chain starting with requested model", () => {
      const chain = buildFallbackChain("mimo/mimo-v2.5-pro");
      assert.ok(chain.length > 0);
      assert.equal(chain[0]!.model.id, "mimo/mimo-v2.5-pro");
      assert.equal(chain[0]!.tier, "premium");

      // Verify downgrade structure is present
      const premiumModels = chain.filter((c) => c.tier === "premium");
      const limitedModels = chain.filter((c) => c.tier === "limited");
      const legacyModels = chain.filter((c) => c.tier === "legacy");

      assert.ok(premiumModels.length > 0);
      assert.ok(limitedModels.length > 0);
      assert.ok(legacyModels.length > 0);
    });

    it("builds a full chain for an unknown model starting with premium models", () => {
      const chain = buildFallbackChain("unknown-model");
      assert.ok(chain.length > 0);
      assert.equal(chain[0]!.tier, "premium");
    });
  });

  describe("nextCandidate", () => {
    const chain: FallbackCandidate[] = [
      {
        tier: "premium",
        model: {
          id: "model-1",
          name: "m1",
          agent: "a",
          tier: "premium",
          contextLength: 100,
          maxOutputTokens: 100,
          supportsVision: false,
        },
      },
      {
        tier: "premium",
        model: {
          id: "model-2",
          name: "m2",
          agent: "a",
          tier: "premium",
          contextLength: 100,
          maxOutputTokens: 100,
          supportsVision: false,
        },
      },
      {
        tier: "limited",
        model: {
          id: "model-3",
          name: "m3",
          agent: "a",
          tier: "limited",
          contextLength: 100,
          maxOutputTokens: 100,
          supportsVision: false,
        },
      },
    ];

    it("returns null on abort", () => {
      const err = new FreebuffAuthError();
      const next = nextCandidate(chain, 0, err);
      assert.equal(next, null);
    });

    it("returns same candidate on retry-same", () => {
      const err = new FreebuffSessionError("rate limit", 429);
      const next = nextCandidate(chain, 0, err);
      assert.deepEqual(next, { candidate: chain[0]!, index: 0 });
    });

    it("returns next candidate in same tier on next-model", () => {
      const err = new FreebuffInvalidAgentModelError();
      const next = nextCandidate(chain, 0, err);
      assert.deepEqual(next, { candidate: chain[1]!, index: 1 });
    });

    it("skips same-tier models and downgrades on downgrade-tier", () => {
      const err = new FreebuffCountryBlockedError();
      const next = nextCandidate(chain, 0, err);
      assert.deepEqual(next, { candidate: chain[2]!, index: 2 });
    });
  });
});

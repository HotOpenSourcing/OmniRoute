import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  FreebuffMetaError,
  freebuffQuotaStateSchema,
  freebuffStreakSchema,
  freebuffLoginStartSchema,
  freebuffLoginStatusSchema,
  unauthorizedError,
} from "../../../../src/lib/providers/freebuff/metaService.ts";

import {
  selectTransformerFormat,
  pipeStreamThroughTransformer,
  freebuffChatRequestSchema,
} from "../../../../src/lib/providers/freebuff/chatIntegration.ts";

import {
  createTransformer,
  friendlyErrorMessage,
  formatSseFrame,
  CodebuffSseParser,
} from "../../../../src/lib/providers/freebuff/stream/index.ts";

// ---------------------------------------------------------------------------
// Public schemas round-trip the documented shapes.
// ---------------------------------------------------------------------------
// Public schemas round-trip the documented shapes.
// ---------------------------------------------------------------------------

test("metaService module loads without duplicate export errors", () => {
  assert.ok(freebuffLoginStartSchema, "login start schema should be exported");
  assert.ok(freebuffLoginStatusSchema, "login status schema should be exported");
  assert.equal(typeof freebuffLoginStartSchema.parse, "function");
  assert.equal(typeof freebuffLoginStatusSchema.parse, "function");
});

describe("freebuff metaService schemas", () => {
  test("freebuffQuotaStateSchema accepts a documented payload", () => {
    const parsed = freebuffQuotaStateSchema.parse({
      sessionsUsedToday: 3,
      sessionsRemainingToday: 7,
      waitingRoomPosition: null,
      resetAt: "2026-07-01T00:00:00.000Z",
      accessTier: "limited",
    });
    assert.equal(parsed.accessTier, "limited");
  });

  test("freebuffQuotaStateSchema rejects an unknown accessTier", () => {
    assert.throws(() =>
      freebuffQuotaStateSchema.parse({
        sessionsUsedToday: 0,
        sessionsRemainingToday: 10,
        waitingRoomPosition: null,
        resetAt: null,
        accessTier: "god-mode",
      }),
    );
  });

  test("freebuffStreakSchema accepts a documented payload", () => {
    const parsed = freebuffStreakSchema.parse({
      currentStreak: 5,
      longestStreak: 12,
      lastCheckInAt: "2026-06-29T18:00:00.000Z",
      bonusCredits: 2,
    });
    assert.equal(parsed.currentStreak, 5);
  });

  test("freebuffLoginStartSchema accepts the oauth wire payload", () => {
    const parsed = freebuffLoginStartSchema.parse({
      loginUrl: "https://codebuff.com/oauth/authorize?...",
      fingerprintHash: "a".repeat(64),
      expiresAt: "2026-07-01T00:00:00.000Z",
    });
    assert.ok(parsed.loginUrl.startsWith("https://"));
    assert.equal(parsed.fingerprintHash, "a".repeat(64));
  });

  test("freebuffLoginStatusSchema accepts a completed payload", () => {
    const parsed = freebuffLoginStatusSchema.parse({
      status: "completed",
      user: {
        authToken: "11111111-2222-3333-4444-555555555555",
        fingerprintId: "fingerprint-id-1",
        fingerprintHash: "a".repeat(64),
        userId: "11111111-2222-3333-4444-555555555555",
        userEmail: "user@example.com",
      },
    });
    assert.equal(parsed.status, "completed");
    assert.equal(parsed.user.userEmail, "user@example.com");
  });

  test("freebuffLoginStatusSchema accepts minimal pending and expired payloads", () => {
    const pending = freebuffLoginStatusSchema.parse({ status: "pending" });
    assert.equal(pending.status, "pending");

    const expired = freebuffLoginStatusSchema.parse({ status: "expired" });
    assert.equal(expired.status, "expired");
  });

  test("freebuffLoginStatusSchema rejects the legacy flat shape", () => {
    assert.throws(() =>
      freebuffLoginStatusSchema.parse({
        flowId: "11111111-2222-3333-4444-555555555555",
        status: "completed",
        authToken: "11111111-2222-3333-4444-555555555555",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// FreebuffMetaError class.
// ---------------------------------------------------------------------------

describe("FreebuffMetaError", () => {
  test("carries status and code", () => {
    const err = new FreebuffMetaError("nope", 403, "forbidden");
    assert.equal(err.status, 403);
    assert.equal(err.code, "forbidden");
    assert.equal(err.name, "FreebuffMetaError");
  });

  test("unauthorizedError defaults to 401", () => {
    const err = unauthorizedError();
    assert.equal(err.status, 401);
    assert.equal(err.code, "unauthorized");
  });

  test("unauthorizedError accepts a custom message", () => {
    const err = unauthorizedError("token expired");
    assert.equal(err.message, "token expired");
  });
});

// ---------------------------------------------------------------------------
// chatIntegration — pure helpers (already implemented, must work today).
// ---------------------------------------------------------------------------

describe("chatIntegration pure helpers", () => {
  test("selectTransformerFormat defaults to openai", () => {
    assert.equal(selectTransformerFormat({ userId: "u1" }), "openai");
  });

  test("selectTransformerFormat honours the format option", () => {
    assert.equal(
      selectTransformerFormat({ userId: "u1", format: "anthropic" }),
      "anthropic",
    );
  });

  test("pipeStreamThroughTransformer wraps a stream with the right format", () => {
    const src = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: response-chunk\ndata: {\"text\":\"hi\"}\n\n"));
        controller.close();
      },
    });
    const wrapped = pipeStreamThroughTransformer(src, "openai", "mimo-v2.5");
    assert.ok(wrapped instanceof ReadableStream);
  });

  test("freebuffChatRequestSchema accepts a documented OpenAI-shaped body", () => {
    const parsed = freebuffChatRequestSchema.parse({
      model: "mimo/mimo-v2.5",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    assert.equal(parsed.model, "mimo/mimo-v2.5");
    assert.equal(parsed.stream, true);
  });

  test("freebuffChatRequestSchema rejects an empty model id", () => {
    assert.throws(() =>
      freebuffChatRequestSchema.parse({ model: "", messages: [] }),
    );
  });
});

// ---------------------------------------------------------------------------
// stream/index.ts re-exports — verify the wiring between modules.
// ---------------------------------------------------------------------------

describe("stream/index.ts re-exports", () => {
  test("createTransformer returns a TransformStream for both formats", () => {
    const openai = createTransformer("openai", { model: "mimo-v2.5" });
    const anthropic = createTransformer("anthropic", { model: "glm-5.2" });
    assert.ok(openai instanceof TransformStream);
    assert.ok(anthropic instanceof TransformStream);
  });

  test("createTransformer throws on unknown format", () => {
    assert.throws(() =>
      createTransformer("unknown" as never, { model: "mimo-v2.5" }),
    );
  });

  test("friendlyErrorMessage handles country_blocked", () => {
    const msg = friendlyErrorMessage({
      type: "prompt-error",
      code: "country_blocked",
      message: "raw stack trace here",
      countryBlockReason: "FR",
    });
    assert.match(msg, /region/);
    assert.match(msg, /FR/);
    assert.doesNotMatch(msg, /stack trace/i);
  });

  test("friendlyErrorMessage handles rate_limited", () => {
    const msg = friendlyErrorMessage({
      type: "prompt-error",
      code: "rate_limited",
      message: "429",
    });
    assert.match(msg, /rate limit/i);
  });

  test("formatSseFrame emits event + data + trailing blank line", () => {
    const frame = formatSseFrame({ event: "message_start", data: '{"x":1}' });
    assert.match(frame, /^event: message_start\n/);
    assert.match(frame, /\ndata: \{"x":1\}\n\n$/);
  });

  test("formatSseFrame omits event line when not provided (OpenAI shape)", () => {
    const frame = formatSseFrame({ data: '{"choices":[]}' });
    assert.ok(!frame.startsWith("event:"));
    assert.match(frame, /^data: /);
    assert.match(frame, /\n\n$/);
  });

  test("CodebuffSseParser parses a complete response-chunk event", () => {
    const parser = new CodebuffSseParser();
    const events = parser.push(
      'event: response-chunk\ndata: {"text":"hello"}\n\n',
    );
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { type: "response-chunk", text: "hello" });
  });

  test("CodebuffSseParser buffers across chunks", () => {
    const parser = new CodebuffSseParser();
    const first = parser.push('event: response-chunk\ndata: {"tex');
    assert.equal(first.length, 0);
    const second = parser.push('t":"hi"}\n\n');
    assert.equal(second.length, 1);
    assert.deepEqual(second[0], { type: "response-chunk", text: "hi" });
  });

  test("CodebuffSseParser returns [] on unknown events", () => {
    const parser = new CodebuffSseParser();
    const events = parser.push("event: future-event\ndata: {}\n\n");
    assert.equal(events.length, 0);
  });
});

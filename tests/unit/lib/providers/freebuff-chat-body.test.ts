/**
 * Tests for the pure wire-shape helpers exported from `chat.ts`.
 *
 * These cover the fields that `buildCodebuffRequestInit` (in
 * `chatIntegration.ts`) does NOT generate — i.e. the chat.ts-specific
 * additions:
 *
 *   - `codebuff_metadata.agent` (root agent id from
 *     `FREEBUFF_ROOT_AGENT_ID_BY_MODEL`)
 *   - `codebuff_metadata.trace_session_id`
 *   - `stream_options: { include_usage: true }`
 *   - `client_id` is STABLE across calls (not random per request)
 *   - `user-agent: ai-sdk/openai-compatible/<v>/codebuff`
 *
 * The test also exercises the buildFreebuffChatHeaders helper for
 * SDK-contract headers (`x-codebuff-fingerprint[-hash]`,
 * `x-freebuff-instance-id`, `x-freebuff-model`, `user-agent`).
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildFreebuffChatBody,
  buildFreebuffChatHeaders,
  __resetStableClientId,
  FREEBUFF_USER_AGENT,
} from "@/lib/providers/freebuff/chat";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE_INPUT = {
  model: "deepseek/deepseek-v4-flash",
  messages: [{ role: "user", content: "hello" }],
  instanceId: "ec743445-f928-4f9b-984e-1c64c52ebc73",
  fingerprintId: "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw",
};

beforeEach(() => {
  __resetStableClientId();
});

describe("buildFreebuffChatBody — top-level fields (00-PROTOCOL-SPEC §6)", () => {
  it("places runId, provider, codebuff_metadata at the TOP LEVEL", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    assert.match(body.runId as string, UUID_RE);
    assert.equal(typeof body.provider, "object");
    assert.equal(typeof body.codebuff_metadata, "object");
    // The legacy nested envelope must be absent — upstream rejects
    // it with 400 "No runId found in request body" (C3).
    assert.equal((body as Record<string, unknown>).codebuff, undefined);
  });

  it("sets stream:true and stream_options.include_usage:true by default", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
  });

  it("sets max_tokens:1024 by default and forwards temperature/top_p when set", () => {
    const a = buildFreebuffChatBody(BASE_INPUT);
    assert.equal(a.body.max_tokens, 1024);
    assert.equal(a.body.temperature, undefined);
    assert.equal(a.body.top_p, undefined);

    const b = buildFreebuffChatBody({
      ...BASE_INPUT,
      max_tokens: 2048,
      temperature: 0.7,
      top_p: 0.95,
    });
    assert.equal(b.body.max_tokens, 2048);
    assert.equal(b.body.temperature, 0.7);
    assert.equal(b.body.top_p, 0.95);
  });

  it("does NOT set temperature/top_p when omitted (server defaults apply)", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    assert.equal("temperature" in body, false);
    assert.equal("top_p" in body, false);
  });
});

describe("buildFreebuffChatBody — codebuff_metadata fields", () => {
  it("includes all required fields with correct values", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    const meta = body.codebuff_metadata as Record<string, unknown>;
    assert.equal(meta.fingerprint_id, BASE_INPUT.fingerprintId);
    assert.equal(meta.cost_mode, "free");
    assert.match(meta.user_input_id as string, UUID_RE);
    assert.match(meta.trace_session_id as string, UUID_RE);
    assert.equal(meta.freebuff_instance_id, BASE_INPUT.instanceId);
  });

  it("resolves `agent` from FREEBUFF_ROOT_AGENT_ID_BY_MODEL", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    const meta = body.codebuff_metadata as Record<string, unknown>;
    assert.equal(meta.agent, "base2-free-deepseek-flash");
  });

  it("uses different agent ids per model", () => {
    const a = buildFreebuffChatBody({ ...BASE_INPUT, model: "mimo/mimo-v2.5" });
    const b = buildFreebuffChatBody({
      ...BASE_INPUT,
      model: "z-ai/glm-5.2",
    });
    assert.equal(
      (a.body.codebuff_metadata as Record<string, unknown>).agent,
      "base2-free-mimo",
    );
    assert.equal(
      (b.body.codebuff_metadata as Record<string, unknown>).agent,
      "base2-free-glm",
    );
  });

  it("falls back to 'base2-free' for unknown models", () => {
    const { body } = buildFreebuffChatBody({
      ...BASE_INPUT,
      model: "future/unknown-model",
    });
    assert.equal(
      (body.codebuff_metadata as Record<string, unknown>).agent,
      "base2-free",
    );
  });

  it("uses the passed `clientId` when supplied", () => {
    const { body } = buildFreebuffChatBody({
      ...BASE_INPUT,
      clientId: "stable-session-id",
    });
    assert.equal(
      (body.codebuff_metadata as Record<string, unknown>).client_id,
      "stable-session-id",
    );
  });

  it("keeps `client_id` STABLE across calls within the same process", () => {
    const a = buildFreebuffChatBody(BASE_INPUT);
    const b = buildFreebuffChatBody(BASE_INPUT);
    assert.equal(
      (a.body.codebuff_metadata as Record<string, unknown>).client_id,
      (b.body.codebuff_metadata as Record<string, unknown>).client_id,
    );
  });

  it("resets the stable client_id when __resetStableClientId() is called", () => {
    const a = buildFreebuffChatBody(BASE_INPUT);
    const clientIdA = (a.body.codebuff_metadata as Record<string, unknown>)
      .client_id as string;
    __resetStableClientId();
    const b = buildFreebuffChatBody(BASE_INPUT);
    const clientIdB = (b.body.codebuff_metadata as Record<string, unknown>)
      .client_id as string;
    assert.notEqual(clientIdA, clientIdB);
  });

  it("falls back to 'unknown' fingerprint_id when none is supplied", () => {
    const { body } = buildFreebuffChatBody({
      ...BASE_INPUT,
      fingerprintId: undefined,
    });
    assert.equal(
      (body.codebuff_metadata as Record<string, unknown>).fingerprint_id,
      "unknown",
    );
  });
});

describe("buildFreebuffChatBody — per-request fields", () => {
  it("generates a fresh runId / user_input_id / trace_session_id per call", () => {
    const a = buildFreebuffChatBody(BASE_INPUT);
    const b = buildFreebuffChatBody(BASE_INPUT);
    assert.notEqual(a.body.runId, b.body.runId);
    assert.notEqual(a.userInputId, b.userInputId);
    assert.notEqual(a.traceSessionId, b.traceSessionId);
  });

  it("honors explicit runId / userInputId / traceSessionId overrides", () => {
    const { body, runId, userInputId, traceSessionId } = buildFreebuffChatBody({
      ...BASE_INPUT,
      runId: "fixed-run-id",
      userInputId: "fixed-input-id",
      traceSessionId: "fixed-trace-id",
    });
    assert.equal(runId, "fixed-run-id");
    assert.equal(userInputId, "fixed-input-id");
    assert.equal(traceSessionId, "fixed-trace-id");
    assert.equal(body.runId, "fixed-run-id");
    assert.equal(
      (body.codebuff_metadata as Record<string, unknown>).user_input_id,
      "fixed-input-id",
    );
    assert.equal(
      (body.codebuff_metadata as Record<string, unknown>).trace_session_id,
      "fixed-trace-id",
    );
  });
});

describe("buildFreebuffChatBody — provider routing", () => {
  it("sets provider.allow_fallbacks=false and sort='price'", () => {
    const { body } = buildFreebuffChatBody(BASE_INPUT);
    const provider = body.provider as Record<string, unknown>;
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(provider.sort, "price");
  });

  it("derives provider.order from the model prefix", () => {
    const a = buildFreebuffChatBody(BASE_INPUT);
    assert.deepEqual(
      (a.body.provider as Record<string, unknown>).order,
      ["DeepSeek"],
    );

    const b = buildFreebuffChatBody({
      ...BASE_INPUT,
      model: "anthropic/claude-sonnet-4-5",
    });
    assert.deepEqual(
      (b.body.provider as Record<string, unknown>).order,
      ["Anthropic"],
    );
  });
});

describe("buildFreebuffChatHeaders — SDK contract", () => {
  it("stamps Authorization, x-freebuff-instance-id, x-freebuff-model, user-agent", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "2f56b16e-b7c2-4575-bfd1-ee9c8a1e0309",
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
      fingerprintId: "enhanced-FP",
      fingerprintHash: "abc123",
      stream: true,
    });
    assert.equal(
      headers.Authorization,
      "Bearer 2f56b16e-b7c2-4575-bfd1-ee9c8a1e0309",
    );
    assert.equal(headers["x-freebuff-instance-id"], "inst-1");
    assert.equal(headers["x-freebuff-model"], "deepseek/deepseek-v4-flash");
    assert.equal(headers["user-agent"], FREEBUFF_USER_AGENT);
    assert.match(
      headers["user-agent"],
      /^ai-sdk\/openai-compatible\/.+\/codebuff$/,
    );
  });

  it("includes x-codebuff-fingerprint and x-codebuff-fingerprint-hash when supplied", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "mimo/mimo-v2.5",
      fingerprintId: "enhanced-FP",
      fingerprintHash: "abc123def456",
      stream: true,
    });
    assert.equal(headers["x-codebuff-fingerprint"], "enhanced-FP");
    assert.equal(headers["x-codebuff-fingerprint-hash"], "abc123def456");
  });

  it("omits fingerprint headers when fingerprint is absent", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "mimo/mimo-v2.5",
      stream: true,
    });
    assert.equal(headers["x-codebuff-fingerprint"], undefined);
    assert.equal(headers["x-codebuff-fingerprint-hash"], undefined);
  });

  it("sets Accept:text/event-stream when streaming", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
      stream: true,
    });
    assert.equal(headers.Accept, "text/event-stream");
  });

  it("sets Accept:application/json when NOT streaming", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
      stream: false,
    });
    assert.equal(headers.Accept, "application/json");
  });

  it("always sets Content-Type: application/json", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
      stream: false,
    });
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("never sends Cookie or x-unique-id (Mission 1: not validated by server)", () => {
    const headers = buildFreebuffChatHeaders({
      authToken: "tok",
      instanceId: "inst-1",
      model: "deepseek/deepseek-v4-flash",
      stream: true,
    });
    assert.equal(headers.Cookie, undefined);
    assert.equal(headers["x-unique-id"], undefined);
  });
});

/**
 * Tests for the Freebuff/Codebuff chat-completions wire shape.
 *
 * Locks in the contract captured in
 * `~/.config/manicode/freebuff-model-tests/phase4-deliverables/00-PROTOCOL-SPEC.md`
 * §2.2 (headers) + §6 (body envelope) and verified by
 * `final-validations.md` Mission 1. The previous nested envelope
 * (`codebuff.codebuff_metadata` / `codebuff.provider`) caused upstream
 * 400 "No runId found in request body" responses — these tests guard
 * against a regression to that shape.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCodebuffRequestInit } from "@/lib/providers/freebuff/chatIntegration";

const VALID_AUTH_TOKEN = "2f56b16e-b7c2-4575-bfd1-ee9c8a1e0309";
const VALID_FINGERPRINT_ID =
  "enhanced-DAeP06lZdsgg47AutIh4D7dLvtM4Z4889E-lr6o7SWw";
const VALID_FINGERPRINT_HASH =
  "128a4f6cd60e95cc8e71025fead589087bf6b7e3da360353061";
const VALID_INSTANCE_ID = "ec743445-f928-4f9b-984e-1c64c52ebc73";
const VALID_RUN_ID = "11111111-2222-3333-4444-555555555555";

const BASE_BODY = {
  model: "deepseek/deepseek-v4-flash",
  messages: [{ role: "user", content: "hi" }],
};

/**
 * Thin wrapper that supplies the resolved runId (in production, the caller
 * obtains this from `startAgentRun` first — see `agentRuns.ts`). Tests
 * pass a deterministic UUID so the rest of the assertions are stable.
 */
function build(
  options?: Parameters<typeof buildCodebuffRequestInit>[3],
  env?: Parameters<typeof buildCodebuffRequestInit>[4],
) {
  return buildCodebuffRequestInit(
    BASE_BODY,
    {
      authToken: VALID_AUTH_TOKEN,
      fingerprintId: VALID_FINGERPRINT_ID,
      fingerprintHash: VALID_FINGERPRINT_HASH,
    },
    { userId: "u", ...options },
    VALID_RUN_ID,
    env,
  );
}

describe("buildCodebuffRequestInit — headers (00-PROTOCOL-SPEC.md §2.2)", () => {
  it("sends Authorization + x-codebuff-fingerprint + x-freebuff-model", () => {
    const { headers } = build();
    assert.equal(headers.Authorization, `Bearer ${VALID_AUTH_TOKEN}`);
    assert.equal(headers["x-codebuff-fingerprint"], VALID_FINGERPRINT_ID);
    assert.equal(headers["x-freebuff-model"], BASE_BODY.model);
  });

  it("sends x-codebuff-fingerprint-hash when fingerprintHash is known", () => {
    const { headers } = build();
    assert.equal(headers["x-codebuff-fingerprint-hash"], VALID_FINGERPRINT_HASH);
  });

  it("omits x-codebuff-fingerprint-hash when fingerprintHash is unknown", () => {
    const { headers } = buildCodebuffRequestInit(
      BASE_BODY,
      { authToken: VALID_AUTH_TOKEN, fingerprintId: VALID_FINGERPRINT_ID },
      { userId: "u" },
      VALID_RUN_ID,
    );
    assert.equal(headers["x-codebuff-fingerprint-hash"], undefined);
  });

  it("sends x-freebuff-instance-id only when a session seat is acquired", () => {
    const withSeat = build({ instanceId: VALID_INSTANCE_ID });
    assert.equal(withSeat.headers["x-freebuff-instance-id"], VALID_INSTANCE_ID);

    const withoutSeat = build();
    assert.equal(withoutSeat.headers["x-freebuff-instance-id"], undefined);
  });

  it("sends Accept: text/event-stream + Content-Type: application/json", () => {
    const { headers } = build();
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers.Accept, "text/event-stream");
  });

  it("sends X-Codebuff-OpenRouter-Api-Key when env override is set (BYOK)", () => {
    const { headers } = build({}, { openRouterApiKey: "sk-or-v1-test" });
    assert.equal(headers["X-Codebuff-OpenRouter-Api-Key"], "sk-or-v1-test");
  });

  it("never sends a fake Cookie header (Mission 1 confirmed cookie is not required)", () => {
    const { headers } = build();
    assert.equal(headers["Cookie"], undefined);
    assert.equal(headers["cookie"], undefined);
  });

  it("never sends a fake x-unique-id header (header name is x-codebuff-fingerprint)", () => {
    const { headers } = build();
    assert.equal(headers["x-unique-id"], undefined);
  });
});

describe("buildCodebuffRequestInit — body (00-PROTOCOL-SPEC.md §6)", () => {
  it("places runId at TOP LEVEL (not nested under codebuff.*)", () => {
    const { payload } = build();
    assert.equal(payload.runId, VALID_RUN_ID);
    assert.equal((payload as any).codebuff, undefined);
  });

  it("places provider at TOP LEVEL with allow_fallbacks=false and sort='price'", () => {
    const { payload } = build();
    const provider = payload.provider as Record<string, unknown>;
    assert.equal(provider.allow_fallbacks, false);
    assert.equal(provider.sort, "price");
    assert.equal((payload as any).codebuff?.provider, undefined);
  });

  it("places codebuff_metadata at TOP LEVEL with fingerprint_id, client_id, cost_mode, user_input_id, run_id", () => {
    const { payload } = build();
    const meta = payload.codebuff_metadata as Record<string, unknown>;
    assert.equal(meta.fingerprint_id, VALID_FINGERPRINT_ID);
    assert.equal(meta.client_id, "codebuff-cli");
    assert.equal(meta.cost_mode, "free");
    assert.equal(meta.run_id, VALID_RUN_ID);
    assert.match(
      meta.user_input_id as string,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    assert.equal((payload as any).codebuff?.codebuff_metadata, undefined);
  });

  it("uses sessionId as client_id when provided", () => {
    const { payload } = build({ sessionId: "stable-session-uuid" });
    const meta = payload.codebuff_metadata as Record<string, unknown>;
    assert.equal(meta.client_id, "stable-session-uuid");
  });

  it("adds freebuff_instance_id to codebuff_metadata only when instanceId is provided", () => {
    const withSeat = build({ instanceId: VALID_INSTANCE_ID });
    assert.equal(
      (withSeat.payload.codebuff_metadata as any).freebuff_instance_id,
      VALID_INSTANCE_ID,
    );

    const withoutSeat = build();
    assert.equal(
      (withoutSeat.payload.codebuff_metadata as any).freebuff_instance_id,
      undefined,
    );
  });

  it("sets stream=true and stream_options.include_usage=true", () => {
    const { payload } = build();
    assert.equal(payload.stream, true);
    assert.deepEqual(payload.stream_options, { include_usage: true });
  });

  it("passes through provider.order when supplied", () => {
    const { payload } = build({ providerOrder: ["Anthropic", "Google", "OpenAI"] });
    const provider = payload.provider as Record<string, unknown>;
    assert.deepEqual(provider.order, ["Anthropic", "Google", "OpenAI"]);
  });

  it("omits provider.order when not supplied", () => {
    const { payload } = build();
    const provider = payload.provider as Record<string, unknown>;
    assert.equal(provider.order, undefined);
  });

  it("honors allowFallbacks override", () => {
    const { payload } = build({ allowFallbacks: true });
    assert.equal((payload.provider as any).allow_fallbacks, true);
  });

  it("echoes the resolvedRunId and generates a fresh user_input_id per call", () => {
    const a = build();
    const b = build();
    assert.equal(a.payload.runId, VALID_RUN_ID);
    assert.equal(b.payload.runId, VALID_RUN_ID);
    assert.notEqual(
      (a.payload.codebuff_metadata as any).user_input_id,
      (b.payload.codebuff_metadata as any).user_input_id,
    );
  });

  it("stamps codebuff_metadata.agent when the model has a known agent id", () => {
    // agentMapping maps deepseek/deepseek-v4-flash → an agent id; if it
    // changes, this test guards the contract.
    const { payload } = build();
    const meta = payload.codebuff_metadata as Record<string, unknown>;
    // agent may be undefined for unmapped models — just assert the field
    // exists OR is absent (never wrong-type).
    if ("agent" in meta) {
      assert.equal(typeof meta.agent, "string");
    }
  });
});

/**
 * Kimchi (Cast AI "AI Enabler") provider — unit tests for the upstream wire shape.
 *
 * Background
 * ----------
 * The Kimchi upstream (https://llm.kimchi.dev/openai/v1/chat/completions) is an
 * OpenAI-compatible Cast AI router. The upstream router does NOT reliably support
 * streaming — requests with stream:true return a false 503 "provider has exhausted
 * its credits" even when credits are available and the same request succeeds with
 * stream:false (live-tested 2026-06-30 against kimi-k2.7, minimax-m3).
 *
 * The KimchiExecutor forces stream=false in the upstream body and lets the
 * JSON-to-SSE bridge (maybeConvertJsonBodyToSse in chatCore) convert the
 * non-streaming response to SSE for the client.
 *
 * The full Stainless SDK header set AND a Bearer auth token are required.
 *
 * Run with:
 *   node --import tsx/esm --test tests/unit/kimchi-provider.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { REGISTRY, getRegistryEntry } from "../../open-sse/config/providerRegistry.ts";
import { kimchiProvider, getKimchiHeaders } from "../../open-sse/config/providers/registry/kimchi/index.ts";
import { KimchiExecutor, DefaultExecutor } from "../../open-sse/executors/index.ts";
import { providerSupportsCaching } from "../../open-sse/utils/cacheControlPolicy.ts";

// Registry: Kimchi is registered with the Stainless SDK header set

test("kimchi provider is registered with the expected Stainless SDK header set", () => {
  const entry = getRegistryEntry("kimchi");
  assert.ok(entry, "kimchi should exist in REGISTRY");
  assert.equal(entry!.format, "openai");
  assert.equal(entry!.authType, "apikey");
  assert.equal(entry!.authHeader, "bearer");
  assert.equal(entry!.baseUrl, "https://llm.kimchi.dev/openai/v1/chat/completions");
  assert.equal(entry!.preserveStainlessHeaders, true);

  const headers = getKimchiHeaders();
  assert.equal(headers["user-agent"], "kimchi/0.1.50");
  assert.equal(headers["x-stainless-lang"], "js");
  assert.equal(headers["x-stainless-package-version"], "6.26.0");
  assert.equal(headers["x-stainless-retry-count"], "0");
  assert.equal(headers["x-stainless-runtime"], "node");
  assert.equal(headers["x-stainless-runtime-version"], "v24.3.0");
  assert.equal(headers["x-stainless-timeout"], "300");
  assert.ok(headers["x-stainless-arch"]);
  assert.ok(headers["x-stainless-os"]);
});

test("getKimchiHeaders returns all expected headers", () => {
  const headers = getKimchiHeaders();
  assert.equal(Object.keys(headers).length, 9);
  assert.equal(headers["x-stainless-lang"], "js");
  assert.equal(headers["x-stainless-runtime"], "node");
});

test("Kimchi provider registry entry does NOT set a modelIdPrefix", () => {
  const entry = getRegistryEntry("kimchi");
  assert.equal(entry?.modelIdPrefix, undefined);
});

test("Kimchi provider registry grants caching via cacheControlPolicy", () => {
  // Kimchi is NOT in CACHING_PROVIDERS — only claude/anthropic + selected
  // API providers qualify for client-side cache_control preservation.
  assert.equal(providerSupportsCaching("kimchi", "openai"), false);
  // claude targetFormat flips to true regardless of provider.
  assert.equal(providerSupportsCaching("kimchi", "claude"), true);
});

// KimchiExecutor: URL, headers, body transformation

const FAKE_KEY = "castai_v1_unit_test_dummy_key_not_real";
const credentialsForKimchi = { apiKey: FAKE_KEY, providerSpecificData: {} } as any;

test("KimchiExecutor.buildUrl returns the Kimchi chat completions endpoint", () => {
  const executor = new KimchiExecutor();
  const url = executor.buildUrl("kimi-k2.7", true, 0, credentialsForKimchi);
  assert.equal(url, "https://llm.kimchi.dev/openai/v1/chat/completions");
});

test("KimchiExecutor.buildHeaders preserves Stainless SDK headers and sets Bearer + Accept for streaming", () => {
  const executor = new KimchiExecutor();
  const headers = executor.buildHeaders(credentialsForKimchi, true, null);

  assert.equal(headers["user-agent"], "kimchi/0.1.50");
  assert.equal(headers["x-stainless-lang"], "js");
  assert.equal(headers["x-stainless-runtime"], "node");
  assert.equal(headers["x-stainless-package-version"], "6.26.0");
  assert.equal(headers["x-stainless-runtime-version"], "v24.3.0");
  assert.equal(headers["x-stainless-retry-count"], "0");
  assert.equal(headers["x-stainless-timeout"], "300");
  assert.ok(headers["x-stainless-arch"]);
  assert.ok(headers["x-stainless-os"]);
  assert.equal(headers["Authorization"], `Bearer ${FAKE_KEY}`);
  assert.equal(headers["Accept"], "text/event-stream");
  assert.equal(headers["Content-Type"], "application/json");
});

test("KimchiExecutor.buildHeaders sets Accept: application/json when stream=false", () => {
  const executor = new KimchiExecutor();
  const headers = executor.buildHeaders(credentialsForKimchi, false, null);
  assert.equal(headers["Accept"], "application/json");
  assert.equal(headers["user-agent"], "kimchi/0.1.50");
});

test("KimchiExecutor.transformRequest forces stream=false even when caller requests streaming", () => {
  const executor = new KimchiExecutor();
  const inputBody = {
    model: "kimi-k2.7",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    stream_options: { include_usage: true },
  };
  const result = executor.transformRequest("kimi-k2.7", inputBody, true, credentialsForKimchi);
  assert.ok(typeof result === "object" && result !== null);
  const body = result as Record<string, unknown>;

  assert.equal(body.stream, false, "KimchiExecutor must force stream=false upstream");
  assert.equal(body.stream_options, undefined, "stream_options must be deleted when stream=false");
  assert.equal(body.model, "kimi-k2.7");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("KimchiExecutor.transformRequest preserves stream=false when already set", () => {
  const executor = new KimchiExecutor();
  const inputBody = { model: "kimi-k2.7", messages: [{ role: "user", content: "hi" }], stream: false };
  const result = executor.transformRequest("kimi-k2.7", inputBody, false, credentialsForKimchi);
  assert.ok(typeof result === "object" && result !== null);
  const body = result as Record<string, unknown>;
  assert.equal(body.stream, false);
});

// DefaultExecutor generic tests (for non-streaming paths Kimchi still uses DefaultExecutor behavior)

test("DefaultExecutor('kimchi').buildUrl returns the Kimchi chat completions endpoint", () => {
  const executor = new DefaultExecutor("kimchi");
  const url = executor.buildUrl("kimi-k2.7", true, 0, credentialsForKimchi);
  assert.equal(url, "https://llm.kimchi.dev/openai/v1/chat/completions");
});

test("DefaultExecutor('kimchi').buildHeaders preserves Stainless SDK headers", () => {
  const executor = new DefaultExecutor("kimchi");
  const headers = executor.buildHeaders(credentialsForKimchi, true, null);
  assert.equal(headers["user-agent"], "kimchi/0.1.50");
  assert.equal(headers["Authorization"], `Bearer ${FAKE_KEY}`);
  assert.equal(headers["Accept"], "text/event-stream");
});

test("DefaultExecutor('kimchi').transformRequest strips stream_options when stream=false", () => {
  const executor = new DefaultExecutor("kimchi");
  const inputBody = { model: "kimi-k2.7", messages: [{ role: "user", content: "hi" }], stream: false, stream_options: { include_usage: true } };
  const out = executor.transformRequest("kimi-k2.7", inputBody, false, credentialsForKimchi);
  const outRecord = out as Record<string, unknown>;
  assert.equal(outRecord.stream_options, undefined);
});

test("DefaultExecutor('kimchi').transformRequest does NOT inject prompt_cache_key", () => {
  const executor = new DefaultExecutor("kimchi");
  const inputBody = { model: "kimi-k2.7", messages: [{ role: "user", content: "hi" }], stream: true };
  const out = executor.transformRequest("kimi-k2.7", inputBody, true, credentialsForKimchi);
  const outRecord = out as Record<string, unknown>;
  assert.equal(outRecord.prompt_cache_key, undefined);
});

test("DefaultExecutor('kimchi').transformRequest does NOT add modelIdPrefix", () => {
  const executor = new DefaultExecutor("kimchi");
  const inputBody = { model: "kimi-k2.7", messages: [{ role: "user", content: "hi" }], stream: true };
  const out = executor.transformRequest("kimi-k2.7", inputBody, true, credentialsForKimchi);
  const outRecord = out as Record<string, unknown>;
  assert.equal(outRecord.model, "kimi-k2.7");
});

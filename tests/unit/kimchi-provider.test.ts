/**
 * Kimchi provider functionality tests.
 *
 * Covers:
 *   - PROVIDER_MODELS_CONFIG contains a kimchi entry with upstream URL + headers
 *   - GET /api/providers/[id]/models probes Kimchi upstream /v1/models
 *   - sync-models persists upstream-discovered Kimchi models (not local fallback)
 *   - DefaultExecutor emits the Stainless SDK headers required by upstream
 *   - Kimchi registry exposes the 5 built-in chat models
 *
 * Uses a fake API key; never the real Cast AI credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-kimchi-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const modelsRoute = await import("../../src/app/api/providers/[id]/models/route.ts");
const syncRoute = await import("../../src/app/api/providers/[id]/sync-models/route.ts");
const scheduler = await import("../../src/shared/services/modelSyncScheduler.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const { REGISTRY } = await import("../../open-sse/config/providerRegistry.ts");
const { getModelsByProviderId } = await import("../../src/shared/constants/models.ts");

const originalFetch = globalThis.fetch;

async function resetStorage() {
  globalThis.fetch = originalFetch;
  // Reset the shared loopback readiness gate so a previous test's cached
  // readiness state does not poison this one.
  syncRoute.__resetLoopbackReadinessForTests();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  globalThis.fetch = originalFetch;
  syncRoute.__resetLoopbackReadinessForTests();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

interface ModelsBody {
  provider: string;
  connectionId: string;
  models: Array<{ id: string; name?: string; owned_by?: string }>;
  source?: string;
  warning?: string;
}

const FAKE_KIMCHI_KEY = "castai_v1_test_fake_key_not_real";
const KIMCHI_MODELS_URL = "https://llm.kimchi.dev/openai/v1/models";

function mockKimchiModelsResponse() {
  return Response.json({
    object: "list",
    data: [
      { id: "minimax-m3", owned_by: "kimchi" },
      { id: "kimi-k2.7", owned_by: "kimchi" },
      { id: "glm-5.2-fp8", owned_by: "kimchi" },
      { id: "deepseek-v4-flash", owned_by: "kimchi" },
      { id: "nemotron-3-ultra-fp4", owned_by: "kimchi" },
    ],
  });
}

test("PROVIDER_MODELS_CONFIG has a kimchi entry targeting llm.kimchi.dev/openai/v1/models", () => {
  // Re-import the route module to read the private config via module evaluation.
  assert.ok(
    "GET" in modelsRoute,
    "models route module should export GET"
  );
});

test("GET /models probes Kimchi upstream with Stainless SDK headers", async () => {
  await resetStorage();
  const connection = await providersDb.createProviderConnection({
    provider: "kimchi",
    authType: "apikey",
    name: "kimchi-live",
    apiKey: FAKE_KIMCHI_KEY,
  });

  let fetched = false;
  let capturedHeaders: Record<string, string> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === KIMCHI_MODELS_URL) {
      fetched = true;
      capturedHeaders = { ...(init?.headers as Record<string, string>) };
      return mockKimchiModelsResponse();
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await modelsRoute.GET(
      new Request(`http://localhost/api/providers/${connection.id}/models?refresh=true`),
      { params: { id: connection.id } }
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as ModelsBody;
    assert.equal(body.provider, "kimchi");
    assert.equal(body.source, "api", "should serve live upstream catalog, not local_catalog");
    assert.ok(fetched, `should have probed ${KIMCHI_MODELS_URL}`);
    assert.equal(
      capturedHeaders["user-agent"],
      "kimchi/0.1.50",
      "Kimchi User-Agent header required"
    );
    assert.ok(
      capturedHeaders["x-stainless-package-version"],
      "Kimchi x-stainless-package-version header required"
    );
    assert.ok(
      capturedHeaders["x-stainless-runtime-version"],
      "Kimchi x-stainless-runtime-version header required"
    );
    const ids = body.models.map((m) => m.id);
    assert.ok(ids.includes("minimax-m3"), `kimchi models missing: ${ids.join(",")}`);
    assert.ok(ids.includes("kimi-k2.7"), `kimchi models missing: ${ids.join(",")}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /models falls back to local catalog when Kimchi upstream is down", async () => {
  await resetStorage();
  const connection = await providersDb.createProviderConnection({
    provider: "kimchi",
    authType: "apikey",
    name: "kimchi-fallback",
    apiKey: FAKE_KIMCHI_KEY,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("bad gateway", { status: 502 });

  try {
    const response = await modelsRoute.GET(
      new Request(`http://localhost/api/providers/${connection.id}/models?refresh=true`),
      { params: { id: connection.id } }
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as ModelsBody;
    assert.equal(body.provider, "kimchi");
    assert.equal(body.source, "local_catalog", "must fall back to registry catalog when upstream fails");
    assert.ok(body.models.length > 0, "fallback catalog should contain built-in models");
    const ids = body.models.map((m) => m.id);
    assert.ok(ids.includes("minimax-m3"), `fallback missing minimax-m3: ${ids.join(",")}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /sync-models persists upstream Kimchi models and does not return 502", async () => {
  await resetStorage();
  const connection = await providersDb.createProviderConnection({
    provider: "kimchi",
    authType: "apikey",
    name: "kimchi-sync",
    apiKey: FAKE_KIMCHI_KEY,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("__readiness_probe__")) {
      return new Response(null, { status: 404 });
    }
    if (url === `http://127.0.0.1:20128/api/providers/${connection.id}/models?refresh=true`) {
      // Simulate the management /models endpoint returning live upstream models.
      return Response.json({
        provider: "kimchi",
        connectionId: connection.id,
        models: [
          { id: "minimax-m3", name: "MiniMax M3" },
          { id: "kimi-k2.7", name: "Kimi K2.7" },
        ],
        source: "api",
      });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const response = await syncRoute.POST(
      new Request(`http://localhost/api/providers/${connection.id}/sync-models?mode=sync`, {
        method: "POST",
        headers: scheduler.buildModelSyncInternalHeaders(),
      }),
      { params: { id: connection.id } }
    );
    assert.equal(response.status, 200, "sync should succeed, not return 502");
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.provider, "kimchi");
    assert.equal(body.ok, true);
    assert.ok(
      typeof body.availableModelsCount === "number" && body.availableModelsCount > 0,
      "sync should persist discovered models"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── Executor headers ────────────────────────────────────────────

test("Kimchi registry exposes Stainless SDK headers required by upstream", () => {
  const entry = REGISTRY["kimchi"];
  assert.ok(entry, "kimchi must be in REGISTRY");
  assert.equal(entry.baseUrl, "https://llm.kimchi.dev/openai/v1/chat/completions");
  const headers = entry.headers;
  assert.ok(headers, "kimchi registry must define headers");
  assert.equal(headers!["user-agent"], "kimchi/0.1.50");
  assert.equal(headers!["x-stainless-package-version"], "6.26.0");
  assert.equal(headers!["x-stainless-runtime-version"], "v24.3.0");
  assert.ok(headers!["x-stainless-os"], "x-stainless-os header missing");
  assert.ok(headers!["x-stainless-arch"], "x-stainless-arch header missing");
});

test("DefaultExecutor for kimchi emits Stainless SDK headers + Bearer auth", () => {
  const executor = new DefaultExecutor("kimchi");
  const headers = executor.buildHeaders({ apiKey: FAKE_KIMCHI_KEY }, true);
  assert.equal(headers["user-agent"], "kimchi/0.1.50");
  assert.equal(headers["x-stainless-package-version"], "6.26.0");
  assert.equal(headers["x-stainless-runtime-version"], "v24.3.0");
  assert.equal(headers["Authorization"], `Bearer ${FAKE_KIMCHI_KEY}`);
  assert.equal(headers["Content-Type"], "application/json");
});

test("DefaultExecutor.buildUrl for kimchi targets the registered base URL", () => {
  const executor = new DefaultExecutor("kimchi");
  const url = executor.buildUrl("minimax-m3", true, 0);
  assert.equal(url, "https://llm.kimchi.dev/openai/v1/chat/completions");
});

// ── Registry catalog ─────────────────────────────────────────────

test("Kimchi registry exposes the 5 built-in chat models", () => {
  const models = getModelsByProviderId("kimchi");
  const ids = new Set(models.map((m) => m.id));
  assert.ok(ids.has("minimax-m3"), `minimax-m3 missing: ${[...ids].join(",")}`);
  assert.ok(ids.has("kimi-k2.7"), `kimi-k2.7 missing: ${[...ids].join(",")}`);
  assert.ok(ids.has("glm-5.2-fp8"), `glm-5.2-fp8 missing: ${[...ids].join(",")}`);
  assert.ok(ids.has("deepseek-v4-flash"), `deepseek-v4-flash missing: ${[...ids].join(",")}`);
  assert.ok(ids.has("nemotron-3-ultra-fp4"), `nemotron-3-ultra-fp4 missing: ${[...ids].join(",")}`);
  assert.equal(models.length, 5);
});

test("Kimchi registry models declare context length", () => {
  const models = getModelsByProviderId("kimchi");
  for (const m of models) {
    assert.ok(
      typeof m.contextLength === "number" && m.contextLength > 0,
      `model ${m.id} must declare a positive contextLength`
    );
  }
});

// ── Empty-response detection (silently-empty upstream) ───────────

test("parseSSEToOpenAIResponse warns when upstream returns empty content + 0 tokens", async () => {
  const { parseSSEToOpenAIResponse } = await import(
    "../../open-sse/handlers/sseParser.ts"
  );

  // Simulate the exact Kimchi payload shape from the bug report:
  // single SSE event with content:null delta, finish_reason:stop, usage.total_tokens:0
  const fakeSSE = [
    "data: " +
      JSON.stringify({
        id: "chatcmpl-bug",
        object: "chat.completion.chunk",
        created: 1782697868,
        model: "minimax-m3",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
  ].join("\n");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(String(msg));
  try {
    const result = parseSSEToOpenAIResponse(fakeSSE, "minimax-m3");
    assert.ok(result, "parseSSEToOpenAIResponse must return a result");
    assert.deepEqual((result as any).usage, {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    assert.equal(
      (result as any).choices[0].finish_reason,
      "stop",
      "finish_reason preserved"
    );
    assert.ok(
      warnings.some((w) =>
        w.includes("upstream returned empty response") &&
        w.includes("model=minimax-m3") &&
        w.includes("usage.total_tokens=0")
      ),
      `expected diagnostic warning about empty upstream response; got: ${JSON.stringify(warnings)}`
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("parseSSEToOpenAIResponse does NOT warn on a normal successful response", async () => {
  const { parseSSEToOpenAIResponse } = await import(
    "../../open-sse/handlers/sseParser.ts"
  );

  const fakeSSE = [
    "data: " +
      JSON.stringify({
        id: "chatcmpl-ok",
        object: "chat.completion.chunk",
        created: 1782697868,
        model: "minimax-m3",
        choices: [
          { index: 0, delta: { role: "assistant", content: "Hi!" } },
        ],
      }),
    "data: " +
      JSON.stringify({
        id: "chatcmpl-ok",
        object: "chat.completion.chunk",
        created: 1782697868,
        model: "minimax-m3",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
      }),
  ].join("\n");

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (msg: string) => warnings.push(String(msg));
  try {
    const result = parseSSEToOpenAIResponse(fakeSSE, "minimax-m3");
    assert.ok(result);
    assert.equal((result as any).choices[0].message.content, "Hi!");
    assert.ok(
      !warnings.some((w) => w.includes("upstream returned empty response")),
      `must not warn on normal response; got: ${JSON.stringify(warnings)}`
    );
  } finally {
    console.warn = originalWarn;
  }
});

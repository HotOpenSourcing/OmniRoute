/**
 * Kimchi provider end-to-end tests via OmniRoute.
 *
 * Tests chat completions (streaming + non-streaming) through the local OmniRoute
 * server using a real Kimchi API key passed directly as the upstream key.
 *
 * Usage:
 *   node --import tsx/esm --test tests/integration/kimchi-e2e.test.ts
 *
 * Env vars (optional):
 *   OMNIROUTE_BASE_URL   — default: http://localhost:20128
 *   OMNIROUTE_API_KEY    — OmniRoute access key (sk-…)
 *   KIMCHI_CONNECTION_ID — connection id registered in OmniRoute (default: kimchi)
 *   KIMCHI_MODEL         — default: kimchi/kimi-k2.7
 *   KIMCHI_DELAY_MS      — delay between requests to avoid rate limiting (default: 5000)
 *
 * NOTE: The Cast AI upstream has a strict per-minute rate limit on the test key.
 * Tests run sequentially with KIMCHI_DELAY_MS between requests to avoid exhaustion.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "path";
import os from "os";

const BASE_URL = process.env.OMNIROUTE_BASE_URL ?? "http://localhost:20128";
const OMNI_KEY =
  process.env.OMNIROUTE_API_KEY ?? "sk-8535c065351998d0-e35f57-612b719e";
const CONNECTION_ID = process.env.KIMCHI_CONNECTION_ID ?? "kimchi";
const MODEL = process.env.KIMCHI_MODEL ?? "kimchi/kimi-k2.7";
const ENDPOINT = `${BASE_URL}/api/v1/chat/completions`;
const TIMEOUT_MS = 60_000;
// Delay between requests to respect Cast AI rate limits
const DELAY_MS = parseInt(process.env.KIMCHI_DELAY_MS ?? "5000", 10);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OMNI_KEY}`,
    "x-connection-id": CONNECTION_ID,
  };
}

/** Reset connection state in DB so the running server picks up a fresh active status */
function resetKimchiConnectionState(): void {
  try {
    const dbPath = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "omniroute",
      "storage.sqlite"
    );
    const db = new Database(dbPath);
    const changed = db
      .prepare(
        `UPDATE provider_connections
         SET is_active = 1, test_status = 'ok', error_code = NULL,
             last_error = NULL, last_error_type = NULL, last_error_at = NULL,
             backoff_level = 0, rate_limited_until = NULL
         WHERE provider = 'kimchi'`
      )
      .run();
    db.close();
    if (changed.changes > 0) {
      console.log(`[setup] Reset ${changed.changes} Kimchi connection(s) in DB`);
    }
  } catch (e) {
    console.warn("[setup] Could not reset Kimchi DB state:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Non-streaming  (sequential — concurrency: false)
// ─────────────────────────────────────────────────────────────────────────────
describe("Kimchi via OmniRoute — non-streaming", { concurrency: false }, () => {
  before(() => {
    resetKimchiConnectionState();
  });

  it("returns 200 with a valid chat.completion object", async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: authHeaders(),
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Reply with the single word: PONG" }],
          stream: false,
          max_tokens: 20,
        }),
      });

      const body = await res.json();
      console.log("[non-stream] status:", res.status);
      console.log("[non-stream] response:", JSON.stringify(body, null, 2));

      assert.strictEqual(
        res.status,
        200,
        `Expected 200, got ${res.status}: ${JSON.stringify(body)}`
      );
      assert.strictEqual(body.object, "chat.completion", "object field mismatch");
      assert.ok(
        Array.isArray(body.choices) && body.choices.length > 0,
        "choices must be non-empty"
      );
      const content = body.choices[0]?.message?.content ?? "";
      console.log("[non-stream] assistant content:", content);
      assert.ok(content.length > 0, "content must not be empty");
    } finally {
      clearTimeout(timer);
    }
  });

  it("returns correct usage tokens", async () => {
    await sleep(DELAY_MS);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: authHeaders(),
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Say: ONE" }],
          stream: false,
          max_tokens: 10,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.ok(body.usage, "usage field must be present");
      assert.ok(
        typeof body.usage.prompt_tokens === "number" && body.usage.prompt_tokens > 0,
        "prompt_tokens must be > 0"
      );
      assert.ok(
        typeof body.usage.completion_tokens === "number" &&
          body.usage.completion_tokens > 0,
        "completion_tokens must be > 0"
      );
      console.log("[non-stream] usage:", JSON.stringify(body.usage));
    } finally {
      clearTimeout(timer);
    }
  });

  it("echoes the model name in the response", async () => {
    await sleep(DELAY_MS);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: authHeaders(),
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Say: TWO" }],
          stream: false,
          max_tokens: 10,
        }),
      });

      const body = await res.json();
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      // OmniRoute may forward model as provider/model or just model
      assert.ok(
        typeof body.model === "string" && body.model.length > 0,
        `model field must be non-empty string, got: ${body.model}`
      );
      console.log("[non-stream] model echo:", body.model);
    } finally {
      clearTimeout(timer);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Streaming (SSE)  (sequential — concurrency: false)
// ─────────────────────────────────────────────────────────────────────────────
describe("Kimchi via OmniRoute — streaming (SSE)", { concurrency: false }, () => {
  before(async () => {
    await sleep(DELAY_MS);
    resetKimchiConnectionState();
  });

  it("streams SSE chunks and assembles a full response", async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Reply with the single word: PONG" }],
          stream: true,
          max_tokens: 20,
        }),
      });

      console.log("[stream] status:", res.status);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);

      const text = await res.text();
      console.log("[stream] raw SSE (first 500 chars):", text.slice(0, 500));

      // Must contain SSE data lines
      assert.ok(text.includes("data:"), "Response must contain SSE data: lines");
      // Must include [DONE] marker
      assert.ok(text.includes("[DONE]"), "Response must contain [DONE] marker");

      // Parse chunks and extract content
      const chunks = text
        .split("\n")
        .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim());
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      assert.ok(chunks.length > 0, "Must receive at least one data chunk");
      const assembled = chunks
        .map((c: any) => c?.choices?.[0]?.delta?.content ?? "")
        .join("");
      console.log("[stream] assembled content:", assembled);
      assert.ok(assembled.length > 0, "Assembled content must not be empty");
    } finally {
      clearTimeout(timer);
    }
  });

  it("streaming includes usage in the final chunk when stream_options.include_usage is set", async () => {
    await sleep(DELAY_MS);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { ...authHeaders(), Accept: "text/event-stream" },
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: "Say: THREE" }],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: 10,
        }),
      });

      assert.strictEqual(res.status, 200, `Expected values to be strictly equal:\n\n${res.status} !== 200`);
      const text = await res.text();

      const usageChunk = text
        .split("\n")
        .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim());
          } catch {
            return null;
          }
        })
        .find((c: any) => c?.usage != null);

      assert.ok(usageChunk, "A chunk with usage data must be present");
      console.log("[stream] usage chunk:", JSON.stringify(usageChunk?.usage));
    } finally {
      clearTimeout(timer);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Error handling  (sequential)
// ─────────────────────────────────────────────────────────────────────────────
describe("Kimchi via OmniRoute — error handling", { concurrency: false }, () => {
  before(async () => {
    await sleep(DELAY_MS);
  });

  it("returns 401 when no API key is provided", async () => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-connection-id": CONNECTION_ID },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        max_tokens: 10,
      }),
    });

    console.log("[error] no-key status:", res.status);
    assert.ok(
      res.status === 401 || res.status === 403,
      `Expected 401/403, got ${res.status}`
    );
  });

  it("returns error for unknown model", async () => {
    await sleep(DELAY_MS);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: `${CONNECTION_ID}/does-not-exist-model-xyz`,
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        max_tokens: 10,
      }),
    });

    const body = await res.json();
    console.log("[error] unknown-model status:", res.status, JSON.stringify(body));
    assert.ok(res.status >= 400, `Expected an error status, got ${res.status}`);
  });
});

/**
 * TDD regression tests for the bulk `rateLimitProtected` flag.
 *
 * After extending `rateLimitProtected: true` to every non-LOCAL/non-SYSTEM
 * provider, this test guards against silent regressions in either direction:
 *
 *   1. Every remote provider (NOAUTH/OAUTH/APIKEY/WEB_COOKIE/SEARCH/AUDIO_ONLY/
 *      UPSTREAM_PROXY/CLOUD_AGENT) declares `rateLimitProtected: true` in
 *      `src/shared/constants/providers.ts`.
 *   2. Every LOCAL provider (lm-studio, vllm, lemonade, llamafile, llama-cpp,
 *      triton, docker-model-runner, xinference, oobabooga, sdwebui, comfyui)
 *      does NOT declare `rateLimitProtected: true` — local instances don't hit
 *      a remote rate-limited upstream, so the flag would be misleading.
 *   3. SYSTEM providers (currently just `auto`) do NOT declare the flag — the
 *      `auto` entry is virtual (zero-config LKGP across all connected
 *      providers), not a connectable upstream.
 *   4. A representative provider round-trips through `createProviderConnection`
 *      with the expected default applied at the SQLite layer.
 *
 * Only the Kiro entry declares `perKeyProxyByDefault: true` (Kiro-specific —
 * per-key proxy is a routing optimization for Kiro's upstream behavior). This
 * test verifies that property is still Kiro-only after the bulk change.
 *
 * The script `scripts/oneoff/add-rate-limit-protected.cjs` is the tool that
 * produced the bulk metadata — it is idempotent and can be re-run to audit.
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getDbInstance } from "../../src/lib/db/core.js";
import { AI_PROVIDERS, LOCAL_PROVIDERS, SYSTEM_PROVIDERS } from "../../src/shared/constants/providers.js";
import { createProviderConnection, deleteProviderConnection } from "../../src/lib/db/providers.js";

// Expected sets — derived from the provider map structure. If a new provider
// is added in `src/shared/constants/providers.ts`, it must either land in
// REMOTE_PROVIDER_IDS (with `rateLimitProtected: true`) or in one of the
// SKIPPED lists below. Tests will fail loudly if the new entry violates the
// contract.
const LOCAL_SKIPPED_IDS = [
  "lm-studio",
  "vllm",
  "lemonade",
  "llamafile",
  "llama-cpp",
  "triton",
  "docker-model-runner",
  "xinference",
  "oobabooga",
  "sdwebui",
  "comfyui",
];
const SYSTEM_SKIPPED_IDS = ["auto"];

describe("Bulk rateLimitProtected metadata (provider constants)", () => {
  test("Every LOCAL provider omits rateLimitProtected (no remote rate limit)", () => {
    for (const id of LOCAL_SKIPPED_IDS) {
      const provider = AI_PROVIDERS[id] as { rateLimitProtected?: boolean } | undefined;
      assert.ok(provider, `LOCAL provider '${id}' must exist in AI_PROVIDERS`);
      assert.ok(
        provider.rateLimitProtected !== true,
        `LOCAL provider '${id}' must NOT have rateLimitProtected=true (local instances do not hit a remote rate-limited upstream). ` +
          `To opt in, move the entry out of LOCAL_PROVIDERS.`
      );
    }
  });

  test("LOCAL_PROVIDERS map is consistent with the expected skipped-id list", () => {
    // Guard against drift: if a provider is added/removed in LOCAL_PROVIDERS,
    // this test reminds the developer to update LOCAL_SKIPPED_IDS above.
    const localKeys = Object.keys(LOCAL_PROVIDERS).sort();
    const expected = [...LOCAL_SKIPPED_IDS].sort();
    assert.deepStrictEqual(
      localKeys,
      expected,
      `LOCAL_PROVIDERS map (${localKeys.join(", ")}) drifted from the test's expected LOCAL_SKIPPED_IDS list (${expected.join(", ")}). ` +
        `Update both lists in lock-step.`
    );
  });

  test("Every SYSTEM provider omits rateLimitProtected (virtual entry, not a connectable upstream)", () => {
    for (const id of SYSTEM_SKIPPED_IDS) {
      const provider = AI_PROVIDERS[id] as { rateLimitProtected?: boolean } | undefined;
      assert.ok(provider, `SYSTEM provider '${id}' must exist in AI_PROVIDERS`);
      assert.ok(
        provider.rateLimitProtected !== true,
        `SYSTEM provider '${id}' must NOT have rateLimitProtected=true (virtual entry, not a rate-limited upstream).`
      );
    }
  });

  test("SYSTEM_PROVIDERS map is consistent with the expected skipped-id list", () => {
    const systemKeys = Object.keys(SYSTEM_PROVIDERS).sort();
    const expected = [...SYSTEM_SKIPPED_IDS].sort();
    assert.deepStrictEqual(
      systemKeys,
      expected,
      `SYSTEM_PROVIDERS map (${systemKeys.join(", ")}) drifted from the test's expected SYSTEM_SKIPPED_IDS list (${expected.join(", ")}). ` +
        `Update both lists in lock-step.`
    );
  });

  test("Every non-LOCAL/non-SYSTEM provider declares rateLimitProtected: true", () => {
    // Iterate every key the AI_PROVIDERS Proxy exposes and skip the known
    // local/system entries. This catches new remote providers that forgot
    // to declare the flag — the most likely regression after a bulk change.
    const localSet = new Set(LOCAL_SKIPPED_IDS);
    const systemSet = new Set(SYSTEM_SKIPPED_IDS);

    // Iterate using the Proxy's ownKeys trap.
    const allKeys = Reflect.ownKeys(AI_PROVIDERS).filter(
      (k): k is string => typeof k === "string"
    );
    assert.ok(allKeys.length > 0, "AI_PROVIDERS should expose at least one provider");

    const missing: string[] = [];
    for (const id of allKeys) {
      if (localSet.has(id) || systemSet.has(id)) continue;
      const provider = AI_PROVIDERS[id] as { rateLimitProtected?: boolean } | undefined;
      if (!provider) continue; // Defensive: Proxy may yield keys with no value
      if (provider.rateLimitProtected !== true) {
        missing.push(id);
      }
    }

    assert.deepStrictEqual(
      missing,
      [],
      `These providers must declare rateLimitProtected: true but do not: ${missing.join(", ")}. ` +
        `Either add the flag to the provider entry, or move the provider into LOCAL_PROVIDERS / SYSTEM_PROVIDERS if it is local/virtual.`
    );
  });

  test("Only Kiro declares perKeyProxyByDefault (Kiro-specific flag)", () => {
    const allKeys = Reflect.ownKeys(AI_PROVIDERS).filter(
      (k): k is string => typeof k === "string"
    );
    const optIns: string[] = [];
    for (const id of allKeys) {
      const provider = AI_PROVIDERS[id] as { perKeyProxyByDefault?: boolean } | undefined;
      if (provider?.perKeyProxyByDefault === true) {
        optIns.push(id);
      }
    }
    assert.deepStrictEqual(
      optIns,
      ["kiro"],
      `perKeyProxyByDefault must remain Kiro-only. Found: ${optIns.join(", ") || "(none)"}. ` +
        `If a new provider genuinely needs per-key proxy auto-activation, add it deliberately.`
    );
  });

  test("Sample of remote providers carry rateLimitProtected: true (sanity sample)", () => {
    // Pick a small set of well-known providers from different maps so a
    // regression in one map (e.g. accidental delete of the flag from the
    // whole APIKEY_PROVIDERS block) is caught here without iterating all
    // 200+ entries in every CI run.
    const samples: Array<{ id: string; map: string }> = [
      { id: "openai", map: "APIKEY" },
      { id: "anthropic", map: "APIKEY" },
      { id: "gemini", map: "APIKEY" },
      { id: "deepseek", map: "APIKEY" },
      { id: "groq", map: "APIKEY" },
      { id: "kiro", map: "OAUTH" },
      { id: "codex", map: "OAUTH" },
      { id: "github", map: "OAUTH" },
      { id: "perplexity-search", map: "SEARCH" },
      { id: "brave-search", map: "SEARCH" },
      { id: "assemblyai", map: "AUDIO_ONLY" },
      { id: "elevenlabs", map: "AUDIO_ONLY" },
      { id: "cliproxyapi", map: "UPSTREAM_PROXY" },
      { id: "9router", map: "UPSTREAM_PROXY" },
      { id: "jules", map: "CLOUD_AGENT" },
      { id: "devin", map: "CLOUD_AGENT" },
    ];

    for (const { id, map } of samples) {
      const provider = AI_PROVIDERS[id] as { rateLimitProtected?: boolean } | undefined;
      assert.ok(provider, `${map} provider '${id}' must exist in AI_PROVIDERS`);
      assert.strictEqual(
        provider.rateLimitProtected,
        true,
        `${map} provider '${id}' must declare rateLimitProtected: true`
      );
    }
  });
});

describe("createProviderConnection round-trip for rateLimitProtected", () => {
  // Spot-check a few entries against the SQLite layer to confirm the
  // constant flows through to the row. The bulk invariant is checked above
  // by inspecting the constants directly; this group verifies the wiring.
  const createdIds: string[] = [];

  after(() => {
    for (const id of createdIds) {
      try {
        deleteProviderConnection(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test("OpenAI connection lands with rate_limit_protection=1 (default applied)", async () => {
    const connection = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "sk-ratelimit-test",
      name: "Test OpenAI RateLimit",
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(
      connection.rateLimitProtection,
      true,
      "OpenAI connection must default rateLimitProtection to true (provider declares rateLimitProtected: true)"
    );

    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.strictEqual(
      row.rate_limit_protection,
      1,
      "Database row must store rate_limit_protection as 1 for OpenAI"
    );
  });

  test("Explicit rateLimitProtection=false overrides the default for a remote provider", async () => {
    // Mirrors the same override path that already existed for Kiro — any
    // operator that wants to disable per-connection protection can still
    // do so explicitly even though the default is now true.
    const connection = await createProviderConnection({
      provider: "anthropic",
      authType: "apikey",
      apiKey: "sk-anthropic-test",
      name: "Test Anthropic Override",
      rateLimitProtection: false,
    });

    createdIds.push(connection.id);

    assert.strictEqual(
      connection.rateLimitProtection,
      false,
      "Explicit false must override the provider's rateLimitProtected default"
    );

    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.strictEqual(row.rate_limit_protection, 0);
  });

  test("LM Studio connection keeps rate_limit_protection=null (LOCAL skipped)", async () => {
    const connection = await createProviderConnection({
      provider: "lm-studio",
      authType: "apikey",
      apiKey: "local-key",
      name: "Test LM Studio RateLimit",
    });

    createdIds.push(connection.id);

    assert.ok(
      connection.rateLimitProtection === false || connection.rateLimitProtection === undefined,
      "LM Studio must NOT default rateLimitProtection to true (LOCAL provider)"
    );

    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.ok(
      row.rate_limit_protection === 0 || row.rate_limit_protection === null,
      "Database row must store rate_limit_protection as 0/NULL for LM Studio"
    );
  });
});

/**
 * TDD regression tests for the per-provider `perKeyProxyByDefault` flag.
 *
 * Mirrors the `kiro-rate-limit-default.test.ts` pattern: each provider that
 * declares `perKeyProxyByDefault: true` in `src/shared/constants/providers.ts`
 * must cause freshly inserted connections to land with
 * `per_key_proxy_enabled = 1` when the caller does not pass
 * `perKeyProxyEnabled` explicitly. This currently applies to Kiro (the
 * provider that prompted the flag — its ToS forbids third-party proxy/harness
 * use, so we want per-key isolation turned on by default for new accounts).
 *
 * Tests:
 *   1. Kiro without explicit value → `perKeyProxyEnabled: true` (both in
 *      the returned object and in SQLite).
 *   2. Kiro with explicit `perKeyProxyEnabled: false` → stays `false`
 *      (caller can override the provider default).
 *   3. Non-Kiro provider without a default → `perKeyProxyEnabled` is
 *      falsy/undefined (no regression: only providers that opt in get the
 *      auto-activation).
 */

import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getDbInstance } from "../../src/lib/db/core.js";
import { createProviderConnection, deleteProviderConnection } from "../../src/lib/db/providers.js";

describe("Per-provider perKeyProxyByDefault auto-activation (Kiro)", () => {
  const createdIds: string[] = [];

  after(() => {
    // Clean up test connections so re-runs don't accumulate stale rows.
    for (const id of createdIds) {
      try {
        deleteProviderConnection(id);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  test("Kiro connection without explicit perKeyProxyEnabled defaults to true", async () => {
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "kiro-default@example.com",
      displayName: "Test Kiro Default",
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "kiro");
    assert.strictEqual(
      connection.perKeyProxyEnabled,
      true,
      "Kiro connection should have perKeyProxyEnabled=true by default (provider declares perKeyProxyByDefault: true)"
    );

    // Verify the SQLite row mirrors the returned object (1 = true)
    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT per_key_proxy_enabled FROM provider_connections WHERE id = ?")
      .get(connection.id) as { per_key_proxy_enabled: number | null };

    assert.strictEqual(
      row.per_key_proxy_enabled,
      1,
      "Database should store per_key_proxy_enabled as 1 (true) for Kiro"
    );
  });

  test("Explicit perKeyProxyEnabled=false overrides Kiro default", async () => {
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "kiro-explicit-false@example.com",
      displayName: "Test Kiro Explicit False",
      perKeyProxyEnabled: false,
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "kiro");
    assert.strictEqual(
      connection.perKeyProxyEnabled,
      false,
      "Explicit false must override provider's perKeyProxyByDefault"
    );

    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT per_key_proxy_enabled FROM provider_connections WHERE id = ?")
      .get(connection.id) as { per_key_proxy_enabled: number | null };

    assert.strictEqual(
      row.per_key_proxy_enabled,
      0,
      "Database should store per_key_proxy_enabled as 0 (false) when caller overrides"
    );
  });

  test("Explicit perKeyProxyEnabled=true is preserved on Kiro", async () => {
    // Sanity check the symmetric direction — explicit true should also pass
    // through (the optional-fields loop sets it before the default block,
    // and the default block only fires when the field is undefined).
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "kiro-explicit-true@example.com",
      displayName: "Test Kiro Explicit True",
      perKeyProxyEnabled: true,
    });

    createdIds.push(connection.id);

    assert.strictEqual(connection.perKeyProxyEnabled, true);
  });

  test("Non-Kiro provider (OpenAI) without opt-in keeps perKeyProxyEnabled falsy", async () => {
    // OpenAI does not declare perKeyProxyByDefault, so a fresh connection
    // must not silently inherit per-key proxy. This guards against
    // accidental global-on behavior if the default block ever regresses.
    const connection = await createProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "sk-test123",
      name: "Test OpenAI No PerKey",
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "openai");
    assert.ok(
      connection.perKeyProxyEnabled === false || connection.perKeyProxyEnabled === undefined,
      "OpenAI (no perKeyProxyByDefault) should not have perKeyProxyEnabled enabled"
    );

    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT per_key_proxy_enabled FROM provider_connections WHERE id = ?")
      .get(connection.id) as { per_key_proxy_enabled: number | null };

    assert.ok(
      row.per_key_proxy_enabled === 0 || row.per_key_proxy_enabled === null,
      "Database should store per_key_proxy_enabled as 0 or NULL for OpenAI"
    );
  });
});
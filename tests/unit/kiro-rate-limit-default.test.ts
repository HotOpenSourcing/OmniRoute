import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getDbInstance } from "../../src/lib/db/core.js";
import { createProviderConnection, deleteProviderConnection } from "../../src/lib/db/providers.js";

describe("Kiro rate limit protection defaults", () => {
  const createdIds: string[] = [];

  after(() => {
    // Clean up test connections
    for (const id of createdIds) {
      try {
        deleteProviderConnection(id);
      } catch (err) {
        // Ignore errors during cleanup
      }
    }
  });

  test("Kiro connections get rate_limit_protection=true by default", async () => {
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "test@example.com",
      displayName: "Test Account",
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "kiro");
    assert.strictEqual(
      connection.rateLimitProtection,
      true,
      "Kiro connection should have rate limit protection enabled by default"
    );

    // Verify in database
    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.strictEqual(
      row.rate_limit_protection,
      1,
      "Database should store rate_limit_protection as 1 (true)"
    );
  });

  test("Explicit rateLimitProtection=false overrides Kiro default", async () => {
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      email: "test-explicit@example.com",
      displayName: "Test Explicit False",
      rateLimitProtection: false,
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "kiro");
    assert.strictEqual(
      connection.rateLimitProtection,
      false,
      "Explicit false should override provider default"
    );

    // Verify in database
    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.strictEqual(
      row.rate_limit_protection,
      0,
      "Database should store rate_limit_protection as 0 (false)"
    );
  });

  test("LOCAL provider (lm-studio) does not get rate_limit_protection by default", async () => {
    // lm-studio is in LOCAL_PROVIDERS — by design it has no `rateLimitProtected`
    // flag in `src/shared/constants/providers.ts` because local instances don't
    // hit a remote upstream with rate limits. The default block in
    // `createProviderConnection` must therefore leave the field falsy/null.
    const connection = await createProviderConnection({
      provider: "lm-studio",
      authType: "apikey",
      apiKey: "local-key",
      name: "Test LM Studio",
    });

    createdIds.push(connection.id);

    assert.ok(connection, "Connection should be created");
    assert.strictEqual(connection.provider, "lm-studio");
    assert.ok(
      connection.rateLimitProtection === false || connection.rateLimitProtection === undefined,
      "LOCAL provider should not have rate limit protection enabled by default"
    );

    // Verify in database
    const db = getDbInstance() as Database.Database;
    const row = db
      .prepare("SELECT rate_limit_protection FROM provider_connections WHERE id = ?")
      .get(connection.id) as { rate_limit_protection: number | null };

    assert.ok(
      row.rate_limit_protection === 0 || row.rate_limit_protection === null,
      "Database should store rate_limit_protection as 0 or NULL for LOCAL provider"
    );
  });
});

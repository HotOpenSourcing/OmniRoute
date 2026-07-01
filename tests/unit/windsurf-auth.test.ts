import test from "node:test";
import assert from "node:assert/strict";

import {
  WindsurfAuthError,
  getCachedWindsurfJwt,
  getWindsurfAuthCacheKey,
  getWindsurfJwt,
  invalidateWindsurfJwtCache,
  normalizeWindsurfIdent,
  resetWindsurfJwtCache,
} from "../../open-sse/services/windsurfAuth.ts";

test.beforeEach(() => {
  resetWindsurfJwtCache();
});

test("normalizeWindsurfIdent trims incoming tokens", () => {
  assert.equal(normalizeWindsurfIdent("  abc  "), "abc");
  assert.equal(normalizeWindsurfIdent("   "), "");
  assert.equal(normalizeWindsurfIdent(null), "");
});

test("getWindsurfAuthCacheKey prefers connectionId when available", () => {
  const withConnection = getWindsurfAuthCacheKey("secret-token", "conn-1");
  const withoutConnection = getWindsurfAuthCacheKey("secret-token");

  assert.equal(withConnection, "windsurf:connection:conn-1");
  assert.ok(withoutConnection.startsWith("windsurf:ident:"));
  assert.notEqual(withoutConnection, "windsurf:ident:secret-token");
});

test("getWindsurfJwt rejects missing identifiers", async () => {
  await assert.rejects(
    () =>
      getWindsurfJwt({
        ident: "   ",
        exchangeJwt: async () => "unused",
      }),
    (error: unknown) => {
      assert.ok(error instanceof WindsurfAuthError);
      assert.equal((error as WindsurfAuthError).code, "token_required");
      return true;
    }
  );
});

test("getWindsurfJwt caches exchange results", async () => {
  let calls = 0;
  const exchangeJwt = async () => {
    calls += 1;
    return "jwt-123";
  };

  const first = await getWindsurfJwt({ ident: "ident-token", connectionId: "conn-1", exchangeJwt });
  const second = await getWindsurfJwt({
    ident: "ident-token",
    connectionId: "conn-1",
    exchangeJwt,
  });

  assert.equal(first, "jwt-123");
  assert.equal(second, "jwt-123");
  assert.equal(calls, 1);
  assert.equal(getCachedWindsurfJwt("ident-token", "conn-1"), "jwt-123");
});

test("invalidateWindsurfJwtCache removes cached entries", async () => {
  await getWindsurfJwt({
    ident: "ident-token",
    connectionId: "conn-2",
    exchangeJwt: async () => "jwt-abc",
  });

  assert.equal(getCachedWindsurfJwt("ident-token", "conn-2"), "jwt-abc");
  invalidateWindsurfJwtCache("conn-2", "ident-token");
  assert.equal(getCachedWindsurfJwt("ident-token", "conn-2"), null);
});

test("getWindsurfJwt rejects empty exchange results", async () => {
  await assert.rejects(
    () =>
      getWindsurfJwt({
        ident: "ident-token",
        exchangeJwt: async () => "   ",
      }),
    (error: unknown) => {
      assert.ok(error instanceof WindsurfAuthError);
      assert.equal((error as WindsurfAuthError).code, "jwt_exchange_failed");
      return true;
    }
  );
});

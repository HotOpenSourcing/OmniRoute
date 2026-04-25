import test from "node:test";
import assert from "node:assert/strict";

import { WINDSURF_CONFIG } from "../../src/lib/oauth/constants/oauth.ts";
import { windsurf } from "../../src/lib/oauth/providers/windsurf.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Windsurf OAuth placeholder metadata is explicit", () => {
  assert.equal(windsurf.metadata.supportLevel, "experimental-manual-token");
  assert.equal(windsurf.metadata.observedInternalAuth, true);
  assert.equal(windsurf.metadata.thirdPartyOAuthSupported, false);
  assert.equal(windsurf.metadata.manualTokenSupported, true);
});

test("Windsurf manual token fallback stays available by default", async () => {
  assert.equal(
    windsurf.buildAuthUrl(WINDSURF_CONFIG, "http://localhost/callback", "state-123", "challenge"),
    "https://windsurf.com/editor/show-auth-token?workflow="
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ api_key: "windsurf-api-key", name: "Windsurf User" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const tokens = await windsurf.exchangeToken(
    WINDSURF_CONFIG,
    "firebase-token-123",
    "http://localhost/callback",
    "verifier-123"
  );

  assert.equal(tokens.api_key, "windsurf-api-key");
});

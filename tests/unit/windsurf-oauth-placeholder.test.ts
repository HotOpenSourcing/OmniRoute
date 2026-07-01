import test from "node:test";
import assert from "node:assert/strict";

import { WINDSURF_CONFIG } from "../../src/lib/oauth/constants/oauth.ts";
import { windsurf } from "../../src/lib/oauth/providers/windsurf.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Windsurf OAuth placeholder metadata is explicit", () => {
  assert.equal(windsurf.metadata.observedInternalAuth, true);
  assert.equal(windsurf.metadata.thirdPartyOAuthSupported, false);
});

test("Windsurf builds the observed browser sign-in URL shape", () => {
  const config = {
    ...WINDSURF_CONFIG,
    enabled: true,
    authorizeUrl: "https://windsurf.com/editor/signin",
    clientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
    redirectUri: "http://localhost:20128/callback",
    scopes: ["openid", "profile", "email"],
  };

  const authUrl = windsurf.buildAuthUrl(config, config.redirectUri, "state-123");

  assert.ok(authUrl);
  const parsed = new URL(authUrl);
  assert.equal(parsed.origin + parsed.pathname, "https://windsurf.com/editor/signin");
  assert.equal(parsed.searchParams.get("response_type"), "token");
  assert.equal(parsed.searchParams.get("client_id"), "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:20128/callback");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert.equal(parsed.searchParams.get("prompt"), "login");
  assert.equal(parsed.searchParams.get("redirect_parameters_type"), "fragment");
});

test("Windsurf still returns a sign-in URL when token exchange is not configured yet", () => {
  const config = {
    ...WINDSURF_CONFIG,
    enabled: false,
    authorizeUrl: "https://windsurf.com/editor/signin",
    clientId: "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u",
    redirectUri: "http://localhost:20128/callback",
    tokenUrl: "",
    scopes: ["openid", "profile", "email"],
  };

  const authUrl = windsurf.buildAuthUrl(config, config.redirectUri, "state-123");

  assert.ok(authUrl);
  assert.match(authUrl, /^https:\/\/windsurf\.com\/editor\/signin\?/);
});

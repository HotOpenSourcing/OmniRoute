import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-windsurf-oauth-route-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
const ORIGINAL_INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_WINDSURF_OAUTH_AUTHORIZE_URL = process.env.WINDSURF_OAUTH_AUTHORIZE_URL;
const ORIGINAL_WINDSURF_OAUTH_CLIENT_ID = process.env.WINDSURF_OAUTH_CLIENT_ID;
const ORIGINAL_WINDSURF_OAUTH_REDIRECT_URI = process.env.WINDSURF_OAUTH_REDIRECT_URI;
const ORIGINAL_WINDSURF_OAUTH_SCOPES = process.env.WINDSURF_OAUTH_SCOPES;

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "test-windsurf-oauth-route-secret";
process.env.INITIAL_PASSWORD = "windsurf-oauth-route-password";
process.env.WINDSURF_OAUTH_AUTHORIZE_URL = "https://windsurf.com/editor/signin";
process.env.WINDSURF_OAUTH_CLIENT_ID = "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u";
process.env.WINDSURF_OAUTH_REDIRECT_URI = "http://localhost:20128/callback";
process.env.WINDSURF_OAUTH_SCOPES = "openid profile email";

const core = await import("../../src/lib/db/core.ts");
const localDb = await import("../../src/lib/localDb.ts");
const oauthRoute = await import("../../src/app/api/oauth/[provider]/[action]/route.ts");

function resetDb() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  resetDb();
  await localDb.updateSettings({ requireLogin: false, password: "", cloudEnabled: false });
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.codeium.com/register_user/") {
      return new Response(
        JSON.stringify({
          api_key: "windsurf-api-key-route",
          name: "Windsurf Route User",
          api_server_url: "https://server.codeium.com",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
});

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;

  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }

  if (ORIGINAL_API_KEY_SECRET === undefined) {
    delete process.env.API_KEY_SECRET;
  } else {
    process.env.API_KEY_SECRET = ORIGINAL_API_KEY_SECRET;
  }

  if (ORIGINAL_INITIAL_PASSWORD === undefined) {
    delete process.env.INITIAL_PASSWORD;
  } else {
    process.env.INITIAL_PASSWORD = ORIGINAL_INITIAL_PASSWORD;
  }

  if (ORIGINAL_WINDSURF_OAUTH_AUTHORIZE_URL === undefined) {
    delete process.env.WINDSURF_OAUTH_AUTHORIZE_URL;
  } else {
    process.env.WINDSURF_OAUTH_AUTHORIZE_URL = ORIGINAL_WINDSURF_OAUTH_AUTHORIZE_URL;
  }

  if (ORIGINAL_WINDSURF_OAUTH_CLIENT_ID === undefined) {
    delete process.env.WINDSURF_OAUTH_CLIENT_ID;
  } else {
    process.env.WINDSURF_OAUTH_CLIENT_ID = ORIGINAL_WINDSURF_OAUTH_CLIENT_ID;
  }

  if (ORIGINAL_WINDSURF_OAUTH_REDIRECT_URI === undefined) {
    delete process.env.WINDSURF_OAUTH_REDIRECT_URI;
  } else {
    process.env.WINDSURF_OAUTH_REDIRECT_URI = ORIGINAL_WINDSURF_OAUTH_REDIRECT_URI;
  }

  if (ORIGINAL_WINDSURF_OAUTH_SCOPES === undefined) {
    delete process.env.WINDSURF_OAUTH_SCOPES;
  } else {
    process.env.WINDSURF_OAUTH_SCOPES = ORIGINAL_WINDSURF_OAUTH_SCOPES;
  }
});

test("POST /api/oauth/windsurf/exchange accepts a full Windsurf callback URL", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callbackUrl:
        "https://windsurf.com/auth/callback?state=state-123&iss=https%3A%2F%2Faccounts.google.com&code=callback-code-123&scope=email+profile+openid",
      redirectUri: "http://localhost:20128/callback",
      codeVerifier: "pkce-verifier-123",
      state: "state-123",
    }),
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);
  assert.equal(payload.connection.provider, "windsurf");

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 1);

  const created = connections[0] as Record<string, any>;
  assert.equal(created.provider, "windsurf");
  assert.equal(created.authType, "oauth");
  assert.equal(created.apiKey, "windsurf-api-key-route");
  assert.equal(created.accessToken, "windsurf-api-key-route");
  assert.equal(created.name, "Windsurf Route User");
  assert.equal(created.testStatus, "active");
  assert.equal(created.isActive, true);
  assert.equal(created.providerSpecificData?.apiServerUrl, "https://server.codeium.com");
  assert.equal(created.providerSpecificData?.authFlow, "windsurf-oauth-pkce");
});

test("POST /api/oauth/windsurf/exchange rejects auth-success URL without token", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callbackUrl:
        "https://windsurf.com/editor/auth-success?client_id=devin-auth&redirect_uri=http%3A%2F%2Flocalhost%3A20128&prompt=login&workflow=&authType=signin&response_type=token&state=state-123&redirect_parameters_type=fragment",
      redirectUri: "http://localhost:20128",
      codeVerifier: "pkce-verifier-123",
      state: "state-123",
    }),
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.message, "Invalid request");
  assert.deepEqual(payload.error.details, [
    {
      field: "callbackUrl",
      message:
        "Callback URL must include a code, id_token, or access_token parameter. Open the Windsurf auth token page and paste the full callback URL after it redirects.",
    },
  ]);

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 0);
});

test("POST /api/oauth/windsurf/exchange accepts token from callback URL fragment", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callbackUrl:
        "https://windsurf.com/editor/auth-success?state=state-123#id_token=fragment-token-123",
      redirectUri: "http://localhost:20128",
      codeVerifier: "pkce-verifier-123",
      state: "state-123",
    }),
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 1);
  assert.equal((connections[0] as Record<string, any>).apiKey, "windsurf-api-key-route");
});

test("POST /api/oauth/windsurf/exchange accepts final redirect URLs with fragment state and access_token", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      callbackUrl:
        "http://localhost:20128/dashboard#state=state-123&access_token=fragment-access-token-123",
      redirectUri: "http://localhost:20128",
      codeVerifier: "pkce-verifier-123",
      state: "state-123",
    }),
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.success, true);

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 1);
  assert.equal((connections[0] as Record<string, any>).apiKey, "windsurf-api-key-route");
});

test("POST /api/oauth/windsurf/exchange rejects empty code", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "   ",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
    }),
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.message, "Invalid request");
  assert.deepEqual(payload.error.details, [
    { field: "code", message: "Too small: expected string to have >=1 characters" },
  ]);
});

test("POST /api/oauth/windsurf/exchange rejects invalid JSON body", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{invalid-json",
  });

  const response = await oauthRoute.POST(request, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.message, "Invalid request");
  assert.deepEqual(payload.error.details, [{ field: "body", message: "Invalid JSON body" }]);
});

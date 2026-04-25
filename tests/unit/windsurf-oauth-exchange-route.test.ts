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

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "test-windsurf-oauth-route-secret";
process.env.INITIAL_PASSWORD = "windsurf-oauth-route-password";

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
});

test("POST /api/oauth/windsurf/exchange creates a Windsurf oauth connection from a manual auth token", async () => {
  const request = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "firebase-id-token-from-windsurf",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
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
  assert.equal(created.providerSpecificData?.authFlow, "windsurf-manual-auth-token");
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

test("POST /api/oauth/windsurf/exchange upserts the existing Windsurf connection on second exchange", async () => {
  let exchangeCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== "https://api.codeium.com/register_user/") {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    exchangeCount += 1;
    const payload =
      exchangeCount === 1
        ? {
            api_key: "windsurf-api-key-route-1",
            name: "Windsurf Route User One",
            api_server_url: "https://server.codeium.com",
          }
        : {
            api_key: "windsurf-api-key-route-2",
            name: "Windsurf Route User Two",
            api_server_url: "https://server.codeium.com",
          };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const firstRequest = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "firebase-id-token-first",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
    }),
  });

  const firstResponse = await oauthRoute.POST(firstRequest, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });
  assert.equal(firstResponse.status, 200);

  const firstConnections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(firstConnections.length, 1);
  const originalId = (firstConnections[0] as Record<string, any>).id;

  const secondRequest = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "firebase-id-token-second",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
    }),
  });

  const secondResponse = await oauthRoute.POST(secondRequest, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });

  assert.equal(secondResponse.status, 200);
  const payload = await secondResponse.json();
  assert.equal(payload.success, true);

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 1);

  const updated = connections[0] as Record<string, any>;
  assert.equal(updated.id, originalId);
  assert.equal(updated.apiKey, "windsurf-api-key-route-2");
  assert.equal(updated.accessToken, "windsurf-api-key-route-2");
  assert.equal(updated.name, "Windsurf Route User Two");
  assert.equal(updated.providerSpecificData?.authFlow, "windsurf-manual-auth-token");
  assert.equal(updated.providerSpecificData?.apiServerUrl, "https://server.codeium.com");
});

test("POST /api/oauth/windsurf/exchange creates a second connection when apiServerUrl differs", async () => {
  let exchangeCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== "https://api.codeium.com/register_user/") {
      throw new Error(`Unexpected fetch: ${url}`);
    }

    exchangeCount += 1;
    const payload =
      exchangeCount === 1
        ? {
            api_key: "windsurf-api-key-route-a",
            name: "Windsurf Route User A",
            api_server_url: "https://server.codeium.com",
          }
        : {
            api_key: "windsurf-api-key-route-b",
            name: "Windsurf Route User B",
            api_server_url: "https://eu.windsurf.com/_route/api_server",
          };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const firstRequest = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "firebase-id-token-first-distinct",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
    }),
  });

  const firstResponse = await oauthRoute.POST(firstRequest, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });
  assert.equal(firstResponse.status, 200);

  const secondRequest = new Request("http://localhost/api/oauth/windsurf/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: "firebase-id-token-second-distinct",
      redirectUri: "http://localhost/callback",
      codeVerifier: "manual-token-flow",
    }),
  });

  const secondResponse = await oauthRoute.POST(secondRequest, {
    params: Promise.resolve({ provider: "windsurf", action: "exchange" }),
  });
  assert.equal(secondResponse.status, 200);

  const connections = await localDb.getProviderConnections({ provider: "windsurf" });
  assert.equal(connections.length, 2);

  const apiServerUrls = connections
    .map((connection) => (connection as Record<string, any>).providerSpecificData?.apiServerUrl)
    .sort();
  assert.deepEqual(apiServerUrls, [
    "https://eu.windsurf.com/_route/api_server",
    "https://server.codeium.com",
  ]);
});

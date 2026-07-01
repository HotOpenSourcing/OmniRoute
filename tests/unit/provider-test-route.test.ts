import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-provider-test-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const testRoute = await import("../../src/app/api/providers/[id]/test/route.ts");

const originalFetch = globalThis.fetch;

async function resetStorage() {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(provider, overrides = {}) {
  return providersDb.createProviderConnection({
    provider,
    authType: overrides.authType || "oauth",
    name: overrides.name || `${provider}-${Math.random().toString(16).slice(2, 8)}`,
    accessToken: overrides.accessToken,
    refreshToken: overrides.refreshToken,
    apiKey: overrides.apiKey,
    expiresAt: overrides.expiresAt,
    isActive: overrides.isActive ?? true,
    testStatus: overrides.testStatus || "active",
    providerSpecificData: overrides.providerSpecificData || {},
  });
}

async function callRoute(connectionId, body = {}) {
  return testRoute.POST(
    new Request(`http://localhost/api/providers/${connectionId}/test`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    {
      params: Promise.resolve({ id: connectionId }),
    }
  );
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  globalThis.fetch = originalFetch;
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("provider test route rejects Windsurf OAuth credentials when self-serve validation returns 401", async () => {
  const connection = await seedConnection("windsurf", {
    accessToken: "windsurf-access-token",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    providerSpecificData: {
      authFlow: "windsurf-oauth-pkce",
      apiServerUrl: "https://server.self-serve.windsurf.com",
    },
  });
  const seenRequests = [];

  globalThis.fetch = async (url, init) => {
    seenRequests.push({
      url: String(url),
      method: init?.method || "GET",
      authorization:
        init?.headers && typeof init.headers === "object" && "Authorization" in init.headers
          ? init.headers.Authorization
          : init?.headers && typeof init.headers === "object" && "authorization" in init.headers
            ? init.headers.authorization
            : null,
    });

    return new Response(JSON.stringify({ code: "unauthenticated", message: "invalid api key" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  };

  const response = await callRoute(connection.id);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.valid, false);
  assert.equal(body.error, "Invalid API key");
  assert.equal(body.warning, null);
  assert.equal(body.diagnosis?.type, "upstream_auth_error");
  assert.equal(body.diagnosis?.source, "upstream");
  assert.deepEqual(seenRequests, [
    {
      url: "https://server.self-serve.windsurf.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
      method: "POST",
      authorization: "Bearer windsurf-access-token",
    },
  ]);
});

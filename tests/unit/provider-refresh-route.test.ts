import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-provider-refresh-route-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-api-key-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const refreshRoute = await import("../../src/app/api/providers/[id]/refresh/route.ts");

async function resetStorage() {
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
    isActive: overrides.isActive ?? true,
    testStatus: overrides.testStatus || "active",
    providerSpecificData: overrides.providerSpecificData || {},
  });
}

async function callRoute(connectionId) {
  return refreshRoute.POST(
    new Request(`http://localhost/api/providers/${connectionId}/refresh`, {
      method: "POST",
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
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("provider refresh route rejects Windsurf manual-token connections without refresh support", async () => {
  const connection = await seedConnection("windsurf", {
    accessToken: "windsurf-access-token",
    refreshToken: null,
    providerSpecificData: {
      authFlow: "windsurf-oauth-pkce",
    },
  });

  const response = await callRoute(connection.id);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Windsurf requires re-authentication",
    requiresReauth: true,
  });
});

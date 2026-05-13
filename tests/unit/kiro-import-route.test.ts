import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-kiro-import-route-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
const ORIGINAL_REQUIRE_API_KEY = process.env.REQUIRE_API_KEY;

process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "test-kiro-import-route-secret";
process.env.REQUIRE_API_KEY = "false";

const core = await import("../../src/lib/db/core.ts");
const localDb = await import("../../src/lib/localDb.ts");
const kiroImportRoute = await import("../../src/app/api/oauth/kiro/import/route.ts");
const kiroServiceModule = await import("../../src/lib/oauth/services/kiro.ts");

function resetDb() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function callImportRoute(body: Record<string, unknown>, search = "") {
  const request = new Request(`http://localhost/api/oauth/kiro/import${search}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return kiroImportRoute.POST(request);
}

test.beforeEach(async () => {
  resetDb();
  await localDb.updateSettings({ requireLogin: false, password: "", cloudEnabled: false });
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });

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

  if (ORIGINAL_REQUIRE_API_KEY === undefined) {
    delete process.env.REQUIRE_API_KEY;
  } else {
    process.env.REQUIRE_API_KEY = ORIGINAL_REQUIRE_API_KEY;
  }
});

test("POST /api/oauth/kiro/import creates a new connection when no matching account exists", async () => {
  const originalValidateImportToken = kiroServiceModule.KiroService.prototype.validateImportToken;
  const originalExtractEmailFromJWT = kiroServiceModule.KiroService.prototype.extractEmailFromJWT;

  kiroServiceModule.KiroService.prototype.validateImportToken = async function () {
    return {
      accessToken: "access-new",
      refreshToken: "refresh-new",
      expiresIn: 3600,
      profileArn: "arn:aws:sso:::profile/test-user",
    };
  };

  kiroServiceModule.KiroService.prototype.extractEmailFromJWT = function () {
    return "kiro-user@example.com";
  };

  try {
    const response = await callImportRoute({ refreshToken: "aorAAAAAG-new-token" });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.alreadyImported, false);

    const connections = await localDb.getProviderConnections({ provider: "kiro" });
    assert.equal(connections.length, 1);

    const created = connections[0] as any;
    assert.equal(created.email, "kiro-user@example.com");
    assert.equal(created.provider, "kiro");
    assert.equal(created.testStatus, "active");
    assert.equal(created.providerSpecificData?.profileArn, "arn:aws:sso:::profile/test-user");
    assert.equal(created.providerSpecificData?.authMethod, "imported");
  } finally {
    kiroServiceModule.KiroService.prototype.validateImportToken = originalValidateImportToken;
    kiroServiceModule.KiroService.prototype.extractEmailFromJWT = originalExtractEmailFromJWT;
  }
});

test("POST /api/oauth/kiro/import updates an existing connection when the email already exists", async () => {
  const originalValidateImportToken = kiroServiceModule.KiroService.prototype.validateImportToken;
  const originalExtractEmailFromJWT = kiroServiceModule.KiroService.prototype.extractEmailFromJWT;

  kiroServiceModule.KiroService.prototype.validateImportToken = async function () {
    return {
      accessToken: "access-updated",
      refreshToken: "refresh-updated",
      expiresIn: 7200,
      profileArn: "arn:aws:sso:::profile/updated-user",
    };
  };

  kiroServiceModule.KiroService.prototype.extractEmailFromJWT = function () {
    return "existing@example.com";
  };

  try {
    const existing = await localDb.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      email: "existing@example.com",
      testStatus: "inactive",
      isActive: false,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/old-user",
        authMethod: "imported",
      },
    });

    const response = await callImportRoute({ refreshToken: "aorAAAAAG-updated-token" });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.alreadyImported, true);
    assert.equal(payload.connection.id, existing.id);

    const connections = await localDb.getProviderConnections({ provider: "kiro" });
    assert.equal(connections.length, 1);

    const updated = connections[0] as any;
    assert.equal(updated.id, existing.id);
    assert.equal(updated.accessToken, "access-updated");
    assert.equal(updated.refreshToken, "refresh-updated");
    assert.equal(updated.email, "existing@example.com");
    assert.equal(updated.testStatus, "active");
    assert.equal(updated.isActive, true);
    assert.equal(updated.providerSpecificData?.profileArn, "arn:aws:sso:::profile/updated-user");
  } finally {
    kiroServiceModule.KiroService.prototype.validateImportToken = originalValidateImportToken;
    kiroServiceModule.KiroService.prototype.extractEmailFromJWT = originalExtractEmailFromJWT;
  }
});

test("POST /api/oauth/kiro/import updates an existing connection when profileArn matches and email is unavailable", async () => {
  const originalValidateImportToken = kiroServiceModule.KiroService.prototype.validateImportToken;
  const originalExtractEmailFromJWT = kiroServiceModule.KiroService.prototype.extractEmailFromJWT;

  kiroServiceModule.KiroService.prototype.validateImportToken = async function () {
    return {
      accessToken: "access-profile-match",
      refreshToken: "refresh-profile-match",
      expiresIn: 1800,
      profileArn: "arn:aws:sso:::profile/profile-match-user",
    };
  };

  kiroServiceModule.KiroService.prototype.extractEmailFromJWT = function () {
    return null;
  };

  try {
    const existing = await localDb.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: "access-before",
      refreshToken: "refresh-before",
      email: null,
      testStatus: "inactive",
      isActive: false,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/profile-match-user",
        authMethod: "imported",
      },
    });

    const response = await callImportRoute({ refreshToken: "aorAAAAAG-profile-token" });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.alreadyImported, true);
    assert.equal(payload.connection.id, existing.id);

    const connections = await localDb.getProviderConnections({ provider: "kiro" });
    assert.equal(connections.length, 1);

    const updated = connections[0] as any;
    assert.equal(updated.id, existing.id);
    assert.equal(updated.accessToken, "access-profile-match");
    assert.equal(updated.refreshToken, "refresh-profile-match");
    assert.equal(updated.email, undefined);
    assert.equal(updated.testStatus, "active");
    assert.equal(updated.isActive, true);
    assert.equal(updated.providerSpecificData?.profileArn, "arn:aws:sso:::profile/profile-match-user");
  } finally {
    kiroServiceModule.KiroService.prototype.validateImportToken = originalValidateImportToken;
    kiroServiceModule.KiroService.prototype.extractEmailFromJWT = originalExtractEmailFromJWT;
  }
});

test("POST /api/oauth/kiro/import returns 409 when multiple existing connections match the import identity", async () => {
  const originalValidateImportToken = kiroServiceModule.KiroService.prototype.validateImportToken;
  const originalExtractEmailFromJWT = kiroServiceModule.KiroService.prototype.extractEmailFromJWT;

  kiroServiceModule.KiroService.prototype.validateImportToken = async function () {
    return {
      accessToken: "access-conflict",
      refreshToken: "refresh-conflict",
      expiresIn: 1800,
      profileArn: "arn:aws:sso:::profile/conflict-user",
    };
  };

  kiroServiceModule.KiroService.prototype.extractEmailFromJWT = function () {
    return null;
  };

  try {
    await localDb.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: "access-one",
      refreshToken: "refresh-one",
      email: null,
      testStatus: "active",
      isActive: true,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/conflict-user",
        authMethod: "imported",
      },
    });

    await localDb.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: "access-two",
      refreshToken: "refresh-two",
      email: null,
      testStatus: "active",
      isActive: true,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/conflict-user",
        authMethod: "imported",
      },
    });

    const response = await callImportRoute({ refreshToken: "aorAAAAAG-conflict-token" });
    assert.equal(response.status, 409);

    const payload = await response.json();
    assert.equal(payload.error, "Multiple existing Kiro connections match this import");

    const connections = await localDb.getProviderConnections({ provider: "kiro" });
    assert.equal(connections.length, 2);
    assert.equal((connections[0] as any).accessToken, "access-one");
    assert.equal((connections[1] as any).accessToken, "access-two");
  } finally {
    kiroServiceModule.KiroService.prototype.validateImportToken = originalValidateImportToken;
    kiroServiceModule.KiroService.prototype.extractEmailFromJWT = originalExtractEmailFromJWT;
  }
});

test("POST /api/oauth/kiro/import scopes idempotent updates to targetProvider=amazon-q", async () => {
  const originalValidateImportToken = kiroServiceModule.KiroService.prototype.validateImportToken;
  const originalExtractEmailFromJWT = kiroServiceModule.KiroService.prototype.extractEmailFromJWT;

  kiroServiceModule.KiroService.prototype.validateImportToken = async function () {
    return {
      accessToken: "access-amazon-updated",
      refreshToken: "refresh-amazon-updated",
      expiresIn: 3600,
      profileArn: "arn:aws:sso:::profile/shared-user",
    };
  };

  kiroServiceModule.KiroService.prototype.extractEmailFromJWT = function () {
    return "shared@example.com";
  };

  try {
    const kiroExisting = await localDb.createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: "access-kiro-original",
      refreshToken: "refresh-kiro-original",
      email: "shared@example.com",
      testStatus: "active",
      isActive: true,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/shared-user",
        authMethod: "imported",
      },
    });

    const amazonExisting = await localDb.createProviderConnection({
      provider: "amazon-q",
      authType: "oauth",
      accessToken: "access-amazon-original",
      refreshToken: "refresh-amazon-original",
      email: "shared@example.com",
      testStatus: "inactive",
      isActive: false,
      providerSpecificData: {
        profileArn: "arn:aws:sso:::profile/shared-user",
        authMethod: "imported",
      },
    });

    const response = await callImportRoute(
      { refreshToken: "aorAAAAAG-amazon-token" },
      "?targetProvider=amazon-q"
    );
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.alreadyImported, true);
    assert.equal(payload.connection.id, amazonExisting.id);
    assert.equal(payload.connection.provider, "amazon-q");

    const kiroConnections = await localDb.getProviderConnections({ provider: "kiro" });
    assert.equal(kiroConnections.length, 1);
    assert.equal((kiroConnections[0] as any).id, kiroExisting.id);
    assert.equal((kiroConnections[0] as any).accessToken, "access-kiro-original");

    const amazonConnections = await localDb.getProviderConnections({ provider: "amazon-q" });
    assert.equal(amazonConnections.length, 1);

    const updated = amazonConnections[0] as any;
    assert.equal(updated.id, amazonExisting.id);
    assert.equal(updated.accessToken, "access-amazon-updated");
    assert.equal(updated.refreshToken, "refresh-amazon-updated");
    assert.equal(updated.email, "shared@example.com");
    assert.equal(updated.testStatus, "active");
    assert.equal(updated.isActive, true);
    assert.equal(updated.providerSpecificData?.profileArn, "arn:aws:sso:::profile/shared-user");
  } finally {
    kiroServiceModule.KiroService.prototype.validateImportToken = originalValidateImportToken;
    kiroServiceModule.KiroService.prototype.extractEmailFromJWT = originalExtractEmailFromJWT;
  }
});

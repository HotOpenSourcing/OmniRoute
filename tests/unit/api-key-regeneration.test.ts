import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omr-apikey-regen-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "test-secret-regen";

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");

async function removeDirWithRetry(targetDir, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      return;
    } catch (error) {
      if ((error?.code === "EBUSY" || error?.code === "EPERM") && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

async function reset() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  await removeDirWithRetry(TEST_DATA_DIR);
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await reset();
});

test.after(async () => {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  await removeDirWithRetry(TEST_DATA_DIR);
});

test("regenerateApiKey creates a new key and invalidates the old one", async () => {
  const machineId = "test-machine-regen";
  const created = await apiKeysDb.createApiKey("Regen Test", machineId);
  const oldKey = created.key;
  const oldId = created.id;

  assert.ok(oldKey);
  assert.equal(await apiKeysDb.validateApiKey(oldKey), true);

  // Regenerate
  const result = await apiKeysDb.regenerateApiKey(oldId);
  assert.ok(result?.key);
  const regenerated = result!.key;

  assert.notEqual(regenerated, oldKey);

  // New key should be valid
  assert.equal(await apiKeysDb.validateApiKey(regenerated), true);

  // Old key should be invalid
  assert.equal(await apiKeysDb.validateApiKey(oldKey), false);

  // Name and machineId should persist
  const md = await apiKeysDb.getApiKeyMetadata(regenerated);
  assert.equal(md?.name, "Regen Test");
  assert.ok(regenerated.startsWith(`sk-${machineId}-`));
});

test("regenerateApiKey returns null for non-existent ID", async () => {
  const result = await apiKeysDb.regenerateApiKey("00000000-0000-0000-0000-000000000000");
  assert.equal(result, null);
});

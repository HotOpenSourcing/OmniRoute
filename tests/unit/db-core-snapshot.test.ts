import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { pathToFileURL } from "node:url";

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removePath(targetPath) {
  const attempts = 10;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const waitUntil = Date.now() + 200;
      while (Date.now() < waitUntil) {}
    }
  }
  // If we reached here, repeated attempts failed (likely Windows file-lock).
  // Try to rename the directory to avoid failing the test while leaving a
  // trace for post-mortem cleanup.
  try {
    const fallback = `${targetPath}.stale-${Date.now()}`;
    try {
      fs.renameSync(targetPath, fallback);
      return;
    } catch {
      // Last resort: ignore — ephemeral test artifacts are acceptable.
      return;
    }
  } catch {
    return;
  }
}

async function importFresh(modulePath) {
  const url = pathToFileURL(path.resolve(modulePath)).href;
  return import(`${url}?test=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

const serial = { concurrency: false };

test("captureCriticalDbState skips very large key_value tables", serial, async () => {
  const dataDir = makeTempDir("omniroute-db-snapshot-");
  const sqliteFile = path.join(dataDir, "storage.sqlite");

  try {
    // Create a DB with many key_value rows that exceed the default threshold
    const seed = new Database(sqliteFile);
    seed.exec(`
      CREATE TABLE key_value (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);

    const insert = seed.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)");
    seed.exec("BEGIN");
    const total = 12000;
    for (let i = 0; i < total; i++) {
      insert.run("bulk", `k${i}`, JSON.stringify({ i }));
    }
    seed.exec("COMMIT");
    seed.close();

    // Directly call the new test helper to inspect the preserved snapshot
    const core = await importFresh("src/lib/db/core.ts");
    const snapshot = core.captureCriticalDbStateForTesting(sqliteFile);

    // key_value should be reported as skipped due to exceeding row limit
    const skipped = snapshot.skippedTables.find((t) => t.table === "key_value");
    assert.ok(skipped, `expected key_value to be skipped, got ${JSON.stringify(snapshot)}`);
    assert.ok(skipped.rowCount >= 12000, `unexpected rowCount: ${skipped.rowCount}`);
    assert.equal(skipped.reason, "row_limit_exceeded");
  } finally {
    removePath(dataDir);
  }
});

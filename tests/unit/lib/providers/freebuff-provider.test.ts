import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireSessionLock,
  releaseLock,
  loadConnection,
  saveConnection,
  ensureFingerprint,
  FreebuffProviderError,
  FREEBUFF_LOCK_PATH,
  FREEBUFF_CREDENTIALS_PATH,
} from "../../../../src/lib/providers/freebuff/provider.ts";

import { fingerprintFromPayload } from "../../../../src/lib/providers/freebuff/fingerprint.ts";

import type { FreebuffConnection } from "../../../../src/shared/schemas/providers/freebuff.ts";

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

const VALID_AUTH_TOKEN = "11111111-1111-1111-1111-111111111111";
const VALID_FINGERPRINT_ID = "enhanced-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const VALID_FINGERPRINT_HASH = "a".repeat(64);

function makeConnection(overrides: Partial<FreebuffConnection> = {}): FreebuffConnection {
  return {
    authToken: VALID_AUTH_TOKEN,
    fingerprintId: VALID_FINGERPRINT_ID,
    fingerprintHash: VALID_FINGERPRINT_HASH,
    accessTier: "limited",
    ...overrides,
  };
}

let tempDir: string;
let originalLockPath: string | undefined;
let originalCredsPath: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "freebuff-provider-"));
  originalLockPath = process.env.FREEBUFF_LOCK_PATH;
  originalCredsPath = process.env.FREEBUFF_CREDENTIALS_PATH;
  process.env.FREEBUFF_LOCK_PATH = join(tempDir, "freebuff.lock");
  process.env.FREEBUFF_CREDENTIALS_PATH = join(tempDir, "credentials.json");
});

afterEach(() => {
  if (originalLockPath === undefined) delete process.env.FREEBUFF_LOCK_PATH;
  else process.env.FREEBUFF_LOCK_PATH = originalLockPath;
  if (originalCredsPath === undefined) delete process.env.FREEBUFF_CREDENTIALS_PATH;
  else process.env.FREEBUFF_CREDENTIALS_PATH = originalCredsPath;
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Session lock.
// ---------------------------------------------------------------------------

describe("session lock", () => {
  test("acquireSessionLock succeeds when no lock exists", async () => {
    const handle = await acquireSessionLock();
    try {
      assert.ok(existsSync(FREEBUFF_LOCK_PATH));
      assert.equal(handle.pid, process.pid);
      assert.equal(handle.released, false);
    } finally {
      await releaseLock(handle);
    }
  });

  test("acquireSessionLock throws when another live PID holds the lock", async () => {
    // Write a lock owned by a different live PID (use init's PID —
    // exists on every Linux/WSL machine and is non-trivial).
    const otherPid = 1;
    writeFileSync(FREEBUFF_LOCK_PATH, String(otherPid));
    try {
      await assert.rejects(
        () => acquireSessionLock(),
        (err: unknown) =>
          err instanceof FreebuffProviderError &&
          err.status === 409 &&
          err.code === "session_locked",
      );
    } finally {
      rmSync(FREEBUFF_LOCK_PATH, { force: true });
    }
  });

  test("acquireSessionLock overwrites a stale lock (PID no longer alive)", async () => {
    // 0x7ffffffful = max 32-bit signed PID; on Linux we can use any
    // large PID that does not exist. Use 999999 — almost certainly dead.
    writeFileSync(FREEBUFF_LOCK_PATH, "999999");
    const handle = await acquireSessionLock();
    try {
      // Lock should now be ours.
      assert.equal(handle.pid, process.pid);
      const content = require("node:fs").readFileSync(FREEBUFF_LOCK_PATH, "utf8");
      assert.equal(content, String(process.pid));
    } finally {
      await releaseLock(handle);
    }
  });

  test("acquireSessionLock overwrites a lock with garbled content", async () => {
    writeFileSync(FREEBUFF_LOCK_PATH, "not-a-pid");
    const handle = await acquireSessionLock();
    try {
      assert.equal(handle.pid, process.pid);
    } finally {
      await releaseLock(handle);
    }
  });

  test("releaseLock is idempotent", async () => {
    const handle = await acquireSessionLock();
    await releaseLock(handle);
    await releaseLock(handle); // second call must not throw
    assert.equal(handle.released, true);
  });

  test("releaseLock removes the lock file", async () => {
    const handle = await acquireSessionLock();
    await releaseLock(handle);
    assert.ok(!existsSync(FREEBUFF_LOCK_PATH));
  });

  test("stale lock from a process that exited is cleaned up", async () => {
    // Write a lock owned by a dead PID with an old mtime, then verify
    // acquireSessionLock replaces it.
    writeFileSync(FREEBUFF_LOCK_PATH, "999999");
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(FREEBUFF_LOCK_PATH, past, past);
    const handle = await acquireSessionLock();
    try {
      assert.equal(handle.pid, process.pid);
    } finally {
      await releaseLock(handle);
    }
  });
});

// ---------------------------------------------------------------------------
// Connection persistence.
// ---------------------------------------------------------------------------

describe("connection persistence", () => {
  test("loadConnection returns null when the file is missing", async () => {
    assert.equal(await loadConnection(), null);
  });

  test("saveConnection + loadConnection round-trip preserves fields", async () => {
    const original = makeConnection({ userEmail: "user@example.com" });
    await saveConnection(original);
    const loaded = await loadConnection();
    assert.ok(loaded);
    assert.equal(loaded.authToken, original.authToken);
    assert.equal(loaded.fingerprintId, original.fingerprintId);
    assert.equal(loaded.fingerprintHash, original.fingerprintHash);
    assert.equal(loaded.userEmail, "user@example.com");
    assert.equal(loaded.accessTier, "limited");
  });

  test("saveConnection creates the parent directory if missing", async () => {
    const nestedPath = join(tempDir, "nested", "deep", "credentials.json");
    process.env.FREEBUFF_CREDENTIALS_PATH = nestedPath;
    await saveConnection(makeConnection());
    assert.ok(existsSync(nestedPath));
  });

  test("loadConnection throws on malformed JSON", async () => {
    writeFileSync(FREEBUFF_CREDENTIALS_PATH, "{ not json");
    await assert.rejects(
      () => loadConnection(),
      (err: unknown) =>
        err instanceof FreebuffProviderError &&
        err.code === "credentials_corrupt",
    );
  });

  test("loadConnection throws when JSON does not match the zod schema", async () => {
    writeFileSync(
      FREEBUFF_CREDENTIALS_PATH,
      JSON.stringify({ authToken: "not-a-uuid" }),
    );
    await assert.rejects(
      () => loadConnection(),
      (err: unknown) =>
        err instanceof FreebuffProviderError &&
        err.code === "credentials_invalid",
    );
  });
});

// ---------------------------------------------------------------------------
// Fingerprint binding.
// ---------------------------------------------------------------------------

describe("ensureFingerprint", () => {
  test("returns the connection unchanged when fingerprint already matches", () => {
    const fp = fingerprintFromPayload("test");
    const conn = makeConnection({
      fingerprintId: fp.fingerprintId,
      fingerprintHash: fp.fingerprintHash,
    });
    const out = ensureFingerprint(conn, fp);
    assert.equal(out, conn);
  });

  test("binds a fresh fingerprint when none is present", () => {
    const fp = fingerprintFromPayload("fresh-host");
    const conn = makeConnection();
    const out = ensureFingerprint(conn, fp);
    assert.notEqual(out, conn);
    assert.equal(out.fingerprintId, fp.fingerprintId);
    assert.equal(out.fingerprintHash, fp.fingerprintHash);
  });

  test("rebinds when the host fingerprint differs (mismatch warning)", () => {
    const old = makeConnection({
      fingerprintId: "enhanced-oldoldoldoldoldoldoldoldoldoldoldoldoldold",
      fingerprintHash: "f".repeat(64),
    });
    const current = fingerprintFromPayload("new-host");
    const out = ensureFingerprint(old, current);
    assert.equal(out.fingerprintId, current.fingerprintId);
    assert.equal(out.fingerprintHash, current.fingerprintHash);
  });
});

// ---------------------------------------------------------------------------
// FreebuffProviderError.
// ---------------------------------------------------------------------------

describe("FreebuffProviderError", () => {
  test("carries status and code", () => {
    const err = new FreebuffProviderError("nope", 503, "down");
    assert.equal(err.status, 503);
    assert.equal(err.code, "down");
    assert.equal(err.name, "FreebuffProviderError");
    assert.equal(err.message, "nope");
  });
});

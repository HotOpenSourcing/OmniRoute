import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireFreebuffLock,
  inspectFreebuffLock,
  isPidAlive,
  readFreebuffLock,
  releaseFreebuffLock,
  resolveFreebuffLockPath,
} from "@/lib/providers/freebuff/lock";

let tmpDir: string;
let lockPath: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "freebuff-lock-test-"));
  lockPath = join(tmpDir, "freebuff-instance-owner.json");
});

after(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  if (existsSync(lockPath)) rmSync(lockPath);
});

describe("isPidAlive", () => {
  it("returns true for the current process", () => {
    assert.equal(isPidAlive(process.pid), true);
  });
  it("returns false for 0 / negative / non-integer", () => {
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(1.5), false);
    assert.equal(isPidAlive(Number.NaN), false);
  });
});

describe("resolveFreebuffLockPath", () => {
  it("returns the input path unchanged when no ~ prefix", () => {
    assert.equal(resolveFreebuffLockPath("/tmp/foo.json"), "/tmp/foo.json");
  });
  it("expands a ~ prefix using HOMEDRIVE/HOMEPATH on win32 / HOME elsewhere", () => {
    const home =
      process.platform === "win32"
        ? `${process.env.HOMEDRIVE ?? ""}${process.env.HOMEPATH ?? ""}`
        : (process.env.HOME ?? "");
    if (!home) return; // skip if env not set
    assert.equal(resolveFreebuffLockPath("~"), `${home}/.config/manicode/freebuff-instance-owner.json`);
    assert.equal(resolveFreebuffLockPath("~/custom.json"), `${home}/custom.json`);
  });
});

describe("readFreebuffLock", () => {
  it("returns null when the lock file does not exist", () => {
    assert.equal(readFreebuffLock(lockPath), null);
  });
  it("returns null when the file is invalid JSON", () => {
    writeFileSync(lockPath, "not json {", "utf8");
    assert.equal(readFreebuffLock(lockPath), null);
  });
  it("returns null when instanceId or pid is missing/invalid", () => {
    writeFileSync(lockPath, JSON.stringify({ instanceId: "x" }), "utf8");
    assert.equal(readFreebuffLock(lockPath), null);
    writeFileSync(lockPath, JSON.stringify({ instanceId: "x", pid: -1 }), "utf8");
    assert.equal(readFreebuffLock(lockPath), null);
    writeFileSync(lockPath, JSON.stringify({ instanceId: "x", pid: "abc" }), "utf8");
    assert.equal(readFreebuffLock(lockPath), null);
  });
  it("returns the record when valid", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "inst-1", pid: 12345, acquiredAt: 1 }),
      "utf8",
    );
    const r = readFreebuffLock(lockPath);
    assert.deepEqual(r, { instanceId: "inst-1", pid: 12345, acquiredAt: 1 });
  });
});

describe("acquireFreebuffLock", () => {
  it("creates a new lock when none exists", () => {
    const r = acquireFreebuffLock({ lockPath });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tookOver, false);
      assert.ok(r.instanceId.length > 0);
      assert.equal(r.pid, process.pid);
    }
  });

  it("creates parent directories when missing", () => {
    const nested = join(tmpDir, "nested", "deep", "lock.json");
    const r = acquireFreebuffLock({ lockPath: nested });
    assert.equal(r.ok, true);
    assert.ok(existsSync(nested));
    rmSync(join(tmpDir, "nested"), { recursive: true, force: true });
  });

  it("refuses when a live PID holds the lock", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "other", pid: process.pid, acquiredAt: 1 }),
      "utf8",
    );
    const r = acquireFreebuffLock({ lockPath });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "held_by_other");
      assert.equal(r.heldBy.instanceId, "other");
      assert.equal(r.heldBy.pid, process.pid);
    }
  });

  it("takes over when the recorded PID is dead and forceTakeOver:false", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "dead", pid: 999_999_999, acquiredAt: 1 }),
      "utf8",
    );
    const r = acquireFreebuffLock({ lockPath });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tookOver, true);
      assert.notEqual(r.instanceId, "dead");
      assert.equal(r.pid, process.pid);
    }
  });

  it("takes over even on live PID when forceTakeOver:true", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "live", pid: process.pid, acquiredAt: 1 }),
      "utf8",
    );
    const r = acquireFreebuffLock({ lockPath, forceTakeOver: true });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tookOver, true);
      assert.notEqual(r.instanceId, "live");
    }
  });
});

describe("releaseFreebuffLock", () => {
  it("returns true when no lock exists (already released)", () => {
    assert.equal(releaseFreebuffLock("any", lockPath), true);
  });
  it("releases when the instanceId matches", () => {
    const r = acquireFreebuffLock({ lockPath });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(releaseFreebuffLock(r.instanceId, lockPath), true);
    assert.equal(existsSync(lockPath), false);
  });
  it("does NOT release when the instanceId differs", () => {
    const r = acquireFreebuffLock({ lockPath });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(releaseFreebuffLock("someone-else", lockPath), false);
    assert.ok(existsSync(lockPath));
  });
});

describe("inspectFreebuffLock", () => {
  it("returns null when no lock exists", () => {
    assert.equal(inspectFreebuffLock(lockPath), null);
  });
  it("returns the holder info with alive flag", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "i", pid: process.pid }),
      "utf8",
    );
    const info = inspectFreebuffLock(lockPath);
    assert.deepEqual(info, { instanceId: "i", pid: process.pid, alive: true });
  });
  it("marks alive:false when the recorded PID is dead", () => {
    writeFileSync(
      lockPath,
      JSON.stringify({ instanceId: "dead", pid: 999_999_999 }),
      "utf8",
    );
    const info = inspectFreebuffLock(lockPath);
    assert.deepEqual(info, { instanceId: "dead", pid: 999_999_999, alive: false });
  });
});

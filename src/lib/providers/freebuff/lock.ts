import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Freebuff waiting-room instance lock.
 *
 * The Codebuff backend enforces a single concurrent instance per user
 * (see `freebuff-instance-owner.json` written by the desktop CLI). When
 * a second instance tries to acquire a slot while one is already active,
 * the backend returns HTTP 409 with `status: "model_locked"`.
 *
 * To prevent that, OmniRoute also writes a local PID file before talking
 * to the server. If the PID file is held by another running process, the
 * current OmniRoute process must decide whether to "take over" (overwrite)
 * or refuse (return a conflict).
 *
 * The lock file path is configurable via `FREEBUFF_LOCK_PATH` and defaults
 * to a sibling of the credentials.json file (the manicode config dir).
 *
 * @module lib/providers/freebuff/lock
 */

export const FREEBUFF_LOCK_PATH_ENV = "FREEBUFF_LOCK_PATH";

/** Default lock file path (sibling of credentials.json). */
export const FREEBUFF_DEFAULT_LOCK_PATH = "~/.config/manicode/freebuff-instance-owner.json";

/** Result of attempting to acquire the lock. */
export type FreebuffLockResult =
  | { ok: true; instanceId: string; pid: number; tookOver: boolean }
  | { ok: false; reason: "held_by_other"; heldBy: { pid: number; instanceId: string } };

export interface FreebuffLockRecord {
  instanceId: string;
  pid: number;
  /** Unix ms when the lock was acquired (informational). */
  acquiredAt?: number;
}

/** PID is "alive" when `process.kill(pid, 0)` doesn't throw ESRCH. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolve the lock file path (basic ~ expansion). */
export function resolveFreebuffLockPath(
  rawPath: string = process.env[FREEBUFF_LOCK_PATH_ENV] ??
    FREEBUFF_DEFAULT_LOCK_PATH,
): string {
  if (rawPath === "~") {
    return `${homedir()}/.config/manicode/freebuff-instance-owner.json`;
  }
  if (rawPath.startsWith("~/")) {
    return homedir() + rawPath.slice(1);
  }
  return rawPath;
}

/** Read the lock file (returns null if absent or invalid). */
export function readFreebuffLock(
  lockPath: string = resolveFreebuffLockPath(),
): FreebuffLockRecord | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FreebuffLockRecord>;
    if (
      typeof parsed.instanceId !== "string" ||
      typeof parsed.pid !== "number" ||
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0
    ) {
      return null;
    }
    return {
      instanceId: parsed.instanceId,
      pid: parsed.pid,
      acquiredAt:
        typeof parsed.acquiredAt === "number" ? parsed.acquiredAt : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Try to acquire the instance lock.
 *
 * - If no lock file exists: write a new one and return `ok: true`.
 * - If a lock file exists and the recorded PID is dead: take over.
 * - If a lock file exists and the recorded PID is alive: return
 *   `{ ok: false, reason: "held_by_other" }` so the caller can surface
 *   a takeover prompt in the UI.
 *
 * `forceTakeOver: true` skips the alive check (caller has decided).
 */
export function acquireFreebuffLock(options: {
  forceTakeOver?: boolean;
  lockPath?: string;
} = {}): FreebuffLockResult {
  const lockPath = options.lockPath ?? resolveFreebuffLockPath();
  const existing = readFreebuffLock(lockPath);

  if (existing && !options.forceTakeOver && isPidAlive(existing.pid)) {
    return {
      ok: false,
      reason: "held_by_other",
      heldBy: { pid: existing.pid, instanceId: existing.instanceId },
    };
  }

  // Either no existing lock, or PID is dead, or forceTakeOver
  const record: FreebuffLockRecord = {
    instanceId: randomUUID(),
    pid: process.pid,
    acquiredAt: Date.now(),
  };

  try {
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(record, null, 2));
  } catch (err) {
    throw new Error(
      `freebuff.acquireFreebuffLock: failed to write lock file: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    ok: true,
    instanceId: record.instanceId,
    pid: record.pid,
    tookOver: Boolean(existing),
  };
}

/**
 * Release the lock if (and only if) the recorded instanceId matches
 * the caller's. Returns `true` if the lock was released, `false` if
 * it was held by another instance.
 */
export function releaseFreebuffLock(
  instanceId: string,
  lockPath: string = resolveFreebuffLockPath(),
): boolean {
  const existing = readFreebuffLock(lockPath);
  if (!existing) return true; // already released
  if (existing.instanceId !== instanceId) return false;

  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the current holder info, or null if the lock is free.
 */
export function inspectFreebuffLock(
  lockPath: string = resolveFreebuffLockPath(),
): { instanceId: string; pid: number; alive: boolean } | null {
  const existing = readFreebuffLock(lockPath);
  if (!existing) return null;
  return {
    instanceId: existing.instanceId,
    pid: existing.pid,
    alive: isPidAlive(existing.pid),
  };
}

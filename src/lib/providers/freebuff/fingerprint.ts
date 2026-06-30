/**
 * Freebuff fingerprint computation — Chunk 3.
 *
 * FORMAT (observed in freebuff.exe)
 * --------------------------------
 * The Codebuff binary authenticates the free tier by attaching a
 * `fingerprint` header to every request. The wire shape is:
 *
 *   enhanced-<43 chars of URL-safe base64 without padding>
 *
 * 43 chars at 6 bits per character = 258 bits, which is consistent with
 * a SHA-256 digest (256 bits) plus one trailing alignment bit. So:
 *
 *   fingerprint = "enhanced-" + base64url(sha256(payload)) without "="
 *
 * where `payload` is a stable concatenation of the host's hardware
 * identifiers (machine-id, hostname, CPU arch, platform).
 *
 * The companion field `fingerprintHash` is the raw 64-char lowercase
 * hex SHA-256 of the same payload, used by some Codebuff endpoints.
 *
 * DETERMINISM
 * -----------
 * The same host MUST produce the same fingerprint on every call. The
 * only inputs are read from the OS at call time — they do not include
 * random or time-varying values. Salted environments (Docker,
 * cloud-init) will produce different fingerprints than the user's
 * local `freebuff login`, which is the documented mismatch the UI
 * warns about (see docs/providers/freebuff.md).
 */

import { createHash } from "node:crypto";
import { hostname, arch, platform } from "node:os";
import { createRequire } from "node:module";

// node-machine-id is already an OmniRoute dependency (see package.json).
// We import dynamically so this module remains usable in environments
// where the package has not been installed (e.g. some test runners).
let machineIdModule: typeof import("node-machine-id") | undefined;
async function loadMachineId(): Promise<typeof import("node-machine-id")> {
  if (!machineIdModule) {
    try {
      machineIdModule = await import("node-machine-id");
    } catch {
      // Fallback: stub the module with an empty id.
      machineIdModule = {
        machineIdSync: () => "",
        machineId: async () => "",
      } as unknown as typeof import("node-machine-id");
    }
  }
  return machineIdModule;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

export interface FreebuffFingerprint {
  /** The header value sent on every Codebuff request. */
  fingerprintId: string;
  /** Raw SHA-256 of the payload, 64-char hex. */
  fingerprintHash: string;
  /** The deterministic payload (debug only — never log in prod). */
  payload: string;
}

export interface FingerprintSources {
  machineId: string;
  hostname: string;
  arch: string;
  platform: string;
}

/**
 * Compute the Freebuff fingerprint for the current host.
 *
 * Returns both the wire-format `fingerprintId` and the raw
 * `fingerprintHash` so callers can attach either to the request. The
 * payload is included for debug / logging.
 */
export async function computeFreebuffFingerprint(): Promise<FreebuffFingerprint> {
  const sources = await collectSources();
  const payload = serialiseSources(sources);
  const hash = sha256Hex(payload);
  return {
    fingerprintId: `enhanced-${base64UrlNoPad(hashBytes(hash))}`,
    fingerprintHash: hash,
    payload,
  };
}

/** Synchronous variant — uses `machineIdSync()` instead of the async API. */
export function computeFreebuffFingerprintSync(): FreebuffFingerprint {
  // Mirror the async pipeline but resolve node-machine-id via createRequire
  // so this stays usable in both CommonJS and ESM test runners. When the
  // module is unavailable (e.g. optional dep not installed) we fall back
  // to an empty machine id — same behaviour as the async path.
  let machineId = "";
  try {
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    machineId = req("node-machine-id").machineIdSync() as string;
  } catch {
    machineId = "";
  }
  const sources: FingerprintSources = {
    machineId,
    hostname: hostname(),
    arch: arch(),
    platform: platform(),
  };
  const payload = serialiseSources(sources);
  const hash = sha256Hex(payload);
  return {
    fingerprintId: `enhanced-${base64UrlNoPad(hashBytes(hash))}`,
    fingerprintHash: hash,
    payload,
  };
}

/**
 * Test seam — re-computes the fingerprint from an explicit payload,
 * bypassing the OS. Useful for golden-file tests and for verifying that
 * the wire format stays stable across changes.
 *
 * The payload is lowercased before hashing so that fingerprints stay
 * stable regardless of input casing — the production serialise path
 * lowercases every field, so this keeps the test seam consistent with
 * the real pipeline.
 */
export function fingerprintFromPayload(payload: string): FreebuffFingerprint {
  const normalised = payload.toLowerCase();
  const hash = sha256Hex(normalised);
  return {
    fingerprintId: `enhanced-${base64UrlNoPad(hashBytes(hash))}`,
    fingerprintHash: hash,
    payload: normalised,
  };
}

/** Convenience — just the `enhanced-…` string. */
export async function fingerprintId(): Promise<string> {
  return (await computeFreebuffFingerprint()).fingerprintId;
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

async function collectSources(): Promise<FingerprintSources> {
  const mod = await loadMachineId();
  const machineId = mod.machineIdSync
    ? mod.machineIdSync()
    : await mod.machineId(true);
  return {
    machineId,
    hostname: hostname(),
    arch: arch(),
    platform: platform(),
  };
}

function serialiseSources(s: FingerprintSources): string {
  // Pipe-separated, lowercased, trimmed. Order is significant — keep it
  // stable across releases or the fingerprint changes silently.
  return [
    `machine=${s.machineId.trim().toLowerCase()}`,
    `host=${s.hostname.trim().toLowerCase()}`,
    `arch=${s.arch.trim().toLowerCase()}`,
    `platform=${s.platform.trim().toLowerCase()}`,
  ].join("|");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hashBytes(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Standard base64url encoding WITHOUT padding. Node's Buffer supports
 * this since v15.7.0 via the `base64url` encoding — but we keep the
 * manual implementation for clarity and to support older runtimes.
 */
function base64UrlNoPad(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

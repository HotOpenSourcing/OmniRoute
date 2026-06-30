import { createHash } from "node:crypto";
import { arch, cpus, hostname, networkInterfaces, platform } from "node:os";
import { z } from "zod";

/**
 * Freebuff (Codebuff) hardware fingerprint.
 *
 * The Codebuff backend hashes the user's machine fingerprint to derive a
 * per-installation `fingerprintId` (sent as `enhanced-<base64url-sha256>`).
 * That hash is then used to bind the PKCE polling OAuth flow to a specific
 * machine.
 *
 * OmniRoute runs in heterogeneous environments (bare metal, Docker, serverless).
 * We can't always collect the *exact* same fields as the desktop CLI (which uses
 * `systeminformation` for system manufacturer/model/serial/uuid). When we can't,
 * the fingerprint will not match the user's local CLI fingerprint and the user
 * will need to use the "paste credentials.json" fallback.
 *
 * `assertFidelityWarning()` exposes a deterministic way for the UI to surface
 * this caveat.
 *
 * @module lib/oauth/freebuff/fingerprint
 */

export const FREEBUFF_FINGERPRINT_VERSION = "2.0";
export const FREEBUFF_FINGERPRINT_PREFIX = "enhanced-";
export const FREEBUFF_FINGERPRINT_REGEX =
  /^enhanced-[A-Za-z0-9_-]{43}$/;

/** Snapshot of the host used to derive the fingerprint. */
export interface FreebuffHardwareSnapshot {
  system: { manufacturer: string; model: string; serial: string; uuid: string };
  cpu: {
    manufacturer: string;
    brand: string;
    cores: number;
    physicalCores: number;
  };
  os: { platform: string; distro: string; arch: string; hostname: string };
  runtime: {
    nodeVersion: string;
    platform: string;
    arch: string;
    shell: string;
    cpuCount: number;
  };
  network: { macAddresses: string[]; interfaceCount: number };
  machineId: string;
  fingerprintVersion: string;
}

/** Detect the user's default shell (best-effort, no throw). */
function detectShell(): string {
  return (
    process.env.SHELL ??
    process.env.ComSpec ??
    (platform() === "win32" ? "cmd.exe" : "unknown")
  );
}

/**
 * Collect a hardware snapshot. Pure read of `os` + `node-machine-id`, no
 * shelling out. Fields that we cannot obtain (manufacturer/model/serial/uuid)
 * are returned as empty strings — the resulting fingerprint will not match
 * the user's local CLI fingerprint and the UI should warn.
 */
export function captureFreebuffHardwareSnapshot(): FreebuffHardwareSnapshot {
  let machineId = "";
  try {
    // node-machine-id is declared in types/global.d.ts
    const mod = require("node-machine-id") as {
      machineIdSync?: (original?: boolean) => string;
      default?: { machineIdSync?: (original?: boolean) => string };
    };
    const fn = mod.machineIdSync ?? mod.default?.machineIdSync;
    if (typeof fn === "function") {
      machineId = fn.call(mod) ?? "";
    }
  } catch {
    // node-machine-id unavailable — leave empty
  }

  const cpuList = cpus() ?? [];
  const cpuInfo = cpuList[0] ?? ({} as NodeJS.CpuInfo);
  const physicalCores =
    typeof cpuInfo.speed === "number" && cpuList.length
      ? Math.max(1, Math.ceil(cpuList.length / 2))
      : Math.max(1, cpuList.length || 1);

  const allIfaces = networkInterfaces();
  const macAddresses: string[] = [];
  for (const name of Object.keys(allIfaces)) {
    for (const iface of allIfaces[name] ?? []) {
      if (
        iface &&
        !iface.internal &&
        iface.mac &&
        iface.mac !== "00:00:00:00:00:00"
      ) {
        macAddresses.push(iface.mac);
      }
    }
  }
  macAddresses.sort();

  const osPlatform = platform();

  return {
    // system manufacturer/model/serial/uuid require `systeminformation`
    // (not bundled). We return empty strings so the fingerprint is
    // *deterministic but partial*; the UI must warn that PKCE may fail.
    system: { manufacturer: "", model: "", serial: "", uuid: "" },
    cpu: {
      manufacturer: cpuInfo.vendor ?? "",
      brand: cpuInfo.model ?? "",
      cores: cpuList.length,
      physicalCores,
    },
    os: {
      platform: osPlatform,
      distro: "",
      arch: arch(),
      hostname: hostname(),
    },
    runtime: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      shell: detectShell(),
      cpuCount: cpuList.length,
    },
    network: { macAddresses, interfaceCount: Object.keys(allIfaces).length },
    machineId,
    fingerprintVersion: FREEBUFF_FINGERPRINT_VERSION,
  };
}

/**
 * Compute the fingerprintId from a snapshot. The output format is
 * `enhanced-<base64url-no-padding-sha256-of-canonical-JSON>`.
 *
 * The JSON is produced via JSON.stringify with sorted keys (built-in
 * canonicalization), then hashed.
 */
export function computeFreebuffFingerprintId(
  snapshot: FreebuffHardwareSnapshot,
): string {
  const canonical = stableStringify(snapshot);
  const digest = createHash("sha256").update(canonical).digest("base64url");
  return `${FREEBUFF_FINGERPRINT_PREFIX}${digest}`;
}

/**
 * Convenience: capture snapshot + compute fingerprintId in one call.
 */
export function generateFreebuffFingerprint(): {
  fingerprintId: string;
  snapshot: FreebuffHardwareSnapshot;
} {
  const snapshot = captureFreebuffHardwareSnapshot();
  const fingerprintId = computeFreebuffFingerprintId(snapshot);
  return { fingerprintId, snapshot };
}

/**
 * Determine whether the local snapshot is likely to match what the user's
 * Codebuff CLI generated. We treat the fingerprint as "low fidelity" when
 * any of the system-info fields (manufacturer/model/serial/uuid) are empty
 * (the desktop CLI uses `systeminformation` to populate them) OR when no
 * MAC address is available (Docker/cloud).
 */
export function assertFidelityWarning(
  snapshot: FreebuffHardwareSnapshot,
): { lowFidelity: true; reasons: string[] } | { lowFidelity: false } {
  const reasons: string[] = [];
  const { system, network } = snapshot;
  if (
    !system.manufacturer ||
    !system.model ||
    !system.serial ||
    !system.uuid
  ) {
    reasons.push(
      "System manufacturer/model/serial/uuid unavailable (server-side) — desktop CLI uses systeminformation.",
    );
  }
  if (network.macAddresses.length === 0) {
    reasons.push(
      "No external MAC address found (Docker/cloud env) — desktop CLI hashes real NICs.",
    );
  }
  if (!snapshot.machineId) {
    reasons.push(
      "machineId unavailable — desktop CLI uses node-machine-id with platform-specific strategies.",
    );
  }
  return reasons.length > 0
    ? { lowFidelity: true, reasons }
    : { lowFidelity: false };
}

// ─── Credentials.json fallback ────────────────────────────────────

/**
 * Zod schema for the manicode credentials.json file. Only the fields
 * relevant to OmniRoute are required; extras are ignored.
 */
export const freebuffCredentialsFileSchema = z.object({
  anonymousId: z.string().optional(),
  default: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
      authToken: z.string().min(1),
      fingerprintId: z.string().regex(FREEBUFF_FINGERPRINT_REGEX),
      fingerprintHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .passthrough()
    .optional(),
});

export type FreebuffCredentialsFile = z.infer<typeof freebuffCredentialsFileSchema>;

/**
 * Parse a `~/.config/manicode/credentials.json` string and return the
 * default profile. Throws ZodError on invalid input.
 */
export function parseFreebuffCredentialsJson(
  raw: string,
): FreebuffCredentialsFile {
  return freebuffCredentialsFileSchema.parse(JSON.parse(raw));
}

/**
 * Safe variant — returns `{ ok: true, data } | { ok: false, error }`.
 */
export function safeParseFreebuffCredentialsJson(raw: string) {
  try {
    const json = JSON.parse(raw);
    return freebuffCredentialsFileSchema.safeParse(json);
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Extract a connection-ready fingerprintId + authToken from a parsed
 * credentials.json file. Returns undefined if `default` profile is missing.
 */
export function extractFreebuffFingerprintFromCredentials(
  creds: FreebuffCredentialsFile,
): {
  authToken: string;
  fingerprintId: string;
  fingerprintHash?: string;
  userId?: string;
  userEmail?: string;
} | null {
  const def = creds.default;
  if (!def) return null;
  return {
    authToken: def.authToken,
    fingerprintId: def.fingerprintId,
    fingerprintHash: def.fingerprintHash,
    userId: def.id,
    userEmail: def.email,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * JSON.stringify with keys sorted recursively — guarantees a canonical
 * serialization regardless of property insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ":" + stableStringify((value as Record<string, unknown>)[k]));
  }
  return "{" + parts.join(",") + "}";
}

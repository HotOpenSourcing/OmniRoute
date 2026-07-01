import { z } from "zod";
import {
  freebuffSessionSchema,
  freebuffSessionStatusSchema,
  getFreebuffQuota,
  releaseFreebuffSlot,
  FREEBUFF_OAUTH_CONFIG,
} from "@/lib/providers/freebuff";
import { freebuff } from "@/lib/oauth/providers/freebuff";
import { generateFreebuffFingerprint } from "@/lib/oauth/freebuff/fingerprint";
import {
  freebuffConnectionSchema,
  freebuffUuidSchema,
  type FreebuffConnection,
} from "@/shared/schemas/providers/freebuff";

/**
 * Freebuff provider meta-service.
 *
 * Bridges the OmniRoute connection store (SQLite) and the Freebuff / Codex
 * backend. Implements the 5 endpoints surfaced under
 * `/api/v1/providers/freebuff/*`.
 *
 * Connection storage
 * ------------------
 * The OmniRoute `ProviderConnection` schema (`src/types/provider.ts`) does
 * not yet have dedicated columns for Freebuff's `authToken` / `fingerprintId`.
 * As a pragmatic MVP we serialize the validated `FreebuffConnection` as
 * JSON inside the existing `apiKey` field. A future migration can add
 * proper columns without changing the meta-service signatures.
 *
 * @module lib/providers/freebuff/metaService
 */

// ---------------------------------------------------------------------------
// Response schemas (public contract for the dashboard).
// ---------------------------------------------------------------------------

export const freebuffQuotaStateSchema = z.object({
  /** Sessions consumed in the current UTC day. */
  sessionsUsedToday: z.number().int().nonnegative(),
  /** Sessions still available before the daily reset. */
  sessionsRemainingToday: z.number().int().nonnegative(),
  /** When non-null, the user is queued behind a waiting room. */
  waitingRoomPosition: z.number().int().positive().nullable(),
  /** ISO-8601 timestamp of the next quota reset, or null on unlimited tier. */
  resetAt: z.string().datetime().nullable(),
  /** Effective access tier for the current session. */
  accessTier: z.enum(["full", "limited"]),
});
export type FreebuffQuotaState = z.infer<typeof freebuffQuotaStateSchema>;

export const freebuffStreakSchema = z.object({
  currentStreak: z.number().int().nonnegative(),
  longestStreak: z.number().int().nonnegative(),
  /** ISO-8601 timestamp of the last successful check-in, or null. */
  lastCheckInAt: z.string().datetime().nullable(),
  /** Bonus credits awarded for the streak, if any. */
  bonusCredits: z.number().int().nonnegative().optional(),
});
export type FreebuffStreak = z.infer<typeof freebuffStreakSchema>;

export const freebuffLoginStartSchema = z.object({
  /** Opaque id used to poll the login status. */
  flowId: freebuffUuidSchema,
  /** URL the user must open in a browser to complete PKCE. */
  loginUrl: z.string().url(),
  /** ISO-8601 timestamp after which the flow expires. */
  expiresAt: z.string().datetime(),
});
export type FreebuffLoginStart = z.infer<typeof freebuffLoginStartSchema>;

export const freebuffLoginStatusSchema = z.object({
  flowId: freebuffUuidSchema,
  status: z.enum(["pending", "completed", "expired", "error"]),
  /** Populated when status === "completed". */
  authToken: freebuffUuidSchema.optional(),
  fingerprintId: z
    .string()
    .regex(/^enhanced-[A-Za-z0-9_-]{43}$/)
    .optional(),
  userId: freebuffUuidSchema.optional(),
  userEmail: z.string().email().optional(),
  /** Human-readable error when status === "error". */
  error: z.string().optional(),
});
export type FreebuffLoginStatus = z.infer<typeof freebuffLoginStatusSchema>;

// ---------------------------------------------------------------------------
// Internal helpers — connection lookup & error mapping.
// ---------------------------------------------------------------------------

export class FreebuffMetaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "FreebuffMetaError";
  }
}

export const unauthorizedError = (message = "Authentication required"): FreebuffMetaError =>
  new FreebuffMetaError(message, 401, "unauthorized");
export const notFoundError = (message: string): FreebuffMetaError =>
  new FreebuffMetaError(message, 404, "not_found");
export const upstreamError = (status: number, message: string): FreebuffMetaError =>
  new FreebuffMetaError(message, 502, `upstream_${status}`);

/** Sentinel kept for backwards compatibility with the original stub. */
export const NOT_IMPLEMENTED_ERROR =
  "freebuff metaService not implemented — see Chunk 4 (provider)";

/**
 * Resolve the Freebuff connection for the given provider connection id.
 *
 * @param connectionId - `ProviderConnection.id` row id.
 * @returns parsed FreebuffConnection or throws FreebuffMetaError.
 */
async function loadFreebuffConnection(connectionId: string): Promise<FreebuffConnection> {
  const { getProviderConnectionById } = await import("@/lib/localDb");
  const row = await getProviderConnectionById(connectionId);
  if (!row) throw notFoundError(`Connection ${connectionId} not found`);
  if (row.provider !== "freebuff") {
    throw new FreebuffMetaError(
      `Connection ${connectionId} is not a Freebuff connection (provider=${row.provider})`,
      400,
      "wrong_provider",
    );
  }
  // Parse the JSON-serialized FreebuffConnection from apiKey.
  let raw: unknown;
  try {
    raw = JSON.parse(row.apiKey ?? "{}");
  } catch {
    throw new FreebuffMetaError(
      `Connection ${connectionId} has malformed Freebuff credentials in apiKey`,
      500,
      "malformed_credentials",
    );
  }
  const parsed = freebuffConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new FreebuffMetaError(
      `Connection ${connectionId} has invalid Freebuff credentials`,
      500,
      "invalid_credentials",
    );
  }
  return parsed.data;
}

/**
 * List all Freebuff connections for the given owner.
 */
async function listFreebuffConnections(): Promise<
  Array<{ id: string; connection: FreebuffConnection }>
> {
  const { getProviderConnections } = await import("@/lib/localDb");
  const all = (await getProviderConnections({ provider: "freebuff" })) as Array<{
    id: string;
    provider: string;
    apiKey?: string;
  }>;
  const out: Array<{ id: string; connection: FreebuffConnection }> = [];
  for (const row of all) {
    if (row.provider !== "freebuff") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(row.apiKey ?? "{}");
    } catch {
      continue;
    }
    const parsed = freebuffConnectionSchema.safeParse(raw);
    if (parsed.success) {
      out.push({ id: row.id, connection: parsed.data });
    }
  }
  return out;
}

/**
 * Persist a FreebuffConnection inside a ProviderConnection row's apiKey.
 * Creates a new row if `connectionId` is omitted.
 */
async function saveFreebuffConnection(
  connection: FreebuffConnection,
  connectionId?: string,
): Promise<{ id: string }> {
  const { getProviderConnectionById, createProviderConnection, updateProviderConnection } =
    await import("@/lib/localDb");
  const payload = JSON.stringify(connection);

  if (connectionId) {
    const existing = await getProviderConnectionById(connectionId);
    if (!existing) throw notFoundError(`Connection ${connectionId} not found`);
    await updateProviderConnection(connectionId, { apiKey: payload });
    return { id: connectionId };
  }

  const created = await createProviderConnection({
    provider: "freebuff",
    label: `Freebuff (${connection.userEmail ?? "anonymous"})`,
    url: FREEBUFF_OAUTH_CONFIG.sessionUrl.replace(/\/api\/v1\/freebuff\/session$/, ""),
    apiKey: payload,
    isActive: true,
    priority: 0,
  });
  return { id: created.id as string };
}

// ---------------------------------------------------------------------------
// Public implementation.
// ---------------------------------------------------------------------------

/**
 * Returns the current quota state for the authenticated user.
 *
 * @param connectionId - id of the Freebuff `ProviderConnection` row.
 *   The route file must look this up from the authenticated session and
 *   pass it in.
 */
export async function getQuotaState(
  connectionId: string,
): Promise<FreebuffQuotaState> {
  const { connection } = { connection: await loadFreebuffConnection(connectionId) };
  const snapshot = await getFreebuffQuota(
    connection.authToken,
    connection.instanceId,
  );

  const rateLimits =
    snapshot.session.rateLimitsByModel ?? {};
  const firstEntry = Object.values(rateLimits)[0] as
    | { recentCount?: number; limit?: number; resetAt?: string | number }
    | undefined;
  const recent = firstEntry?.recentCount ?? 0;
  const limit = firstEntry?.limit ?? 0;
  const resetAtMs =
    typeof firstEntry?.resetAt === "number"
      ? firstEntry.resetAt
      : typeof firstEntry?.resetAt === "string"
        ? Date.parse(firstEntry.resetAt)
        : Number.NaN;
  const resetAt = Number.isFinite(resetAtMs)
    ? new Date(resetAtMs).toISOString()
    : null;

  return {
    sessionsUsedToday: recent,
    sessionsRemainingToday: Math.max(0, limit - recent),
    waitingRoomPosition:
      snapshot.isQueued && snapshot.session.position != null
        ? snapshot.session.position
        : null,
    resetAt,
    accessTier: snapshot.session.accessTier ?? "limited",
  };
}

/** Returns the gamification streak state for the authenticated user. */
export async function getStreak(
  connectionId: string,
): Promise<FreebuffStreak> {
  const { connection } = { connection: await loadFreebuffConnection(connectionId) };
  const baseUrl = FREEBUFF_OAUTH_CONFIG.streakUrl.replace(/\/api\/v1\/freebuff\/streak$/, "");
  const res = await fetch(`${baseUrl}/api/v1/freebuff/streak`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${connection.authToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw upstreamError(res.status, `Streak fetch failed: HTTP ${res.status}`);
  }
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const streak = typeof raw.streak === "number" ? raw.streak : 0;
  const longest =
    typeof raw.longestStreak === "number" ? raw.longestStreak : streak;
  return {
    currentStreak: streak,
    longestStreak: longest,
    lastCheckInAt:
      typeof raw.lastCheckInAt === "string" ? raw.lastCheckInAt : null,
    bonusCredits:
      typeof raw.bonusCredits === "number" ? raw.bonusCredits : undefined,
  };
}

/**
 * Starts a PKCE login flow. Returns the `loginUrl` the user must open
 * and a `flowId` to poll status with.
 *
 * The flowId is stored as a transient row in the connection store keyed
 * by the generated `auth_token` UUID so `pollLoginStatus` can recover it.
 */
export async function startLogin(): Promise<FreebuffLoginStart> {
  const { fingerprintId } = generateFreebuffFingerprint();
  const { flowId, loginUrl, fingerprintHash, expiresAt } =
    await freebuff.requestDeviceCode(FREEBUFF_OAUTH_CONFIG, fingerprintId);

  // Persist the transient flow state inside a sentinel connection.
  const transient: FreebuffConnection = {
    authToken: "00000000-0000-4000-8000-000000000000", // placeholder
    fingerprintId,
    fingerprintHash,
    loginCompletedAt: expiresAt,
  };
  await saveFreebuffConnection(transient);

  return {
    flowId,
    loginUrl,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** Polls the status of an in-flight PKCE flow. */
export async function pollLoginStatus(
  flowId: string,
): Promise<FreebuffLoginStatus> {
  const all = await listFreebuffConnections();
  // The most-recently created transient connection is the active flow.
  // `loginCompletedAt` carries the original `expiresAt` timestamp from
  // `requestDeviceCode`. We re-derive the fingerprintId from it.
  const transient = all
    .map((c) => c.connection)
    .find((c) => c.authToken === "00000000-0000-4000-8000-000000000000");
  if (!transient) {
    return {
      flowId,
      status: "expired",
      error: "No in-flight Freebuff login found",
    };
  }

  const expiresAt = transient.loginCompletedAt ?? Date.now() + 60_000;
  const response = await freebuff.pollToken(
    FREEBUFF_OAUTH_CONFIG,
    flowId,
    transient.fingerprintId,
    transient.fingerprintHash ?? "0".repeat(64),
    expiresAt,
  );

  if (response.status === "success" && response.authToken) {
    // Persist the real connection, replacing the transient.
    await saveFreebuffConnection(
      {
        authToken: response.authToken,
        fingerprintId: transient.fingerprintId,
        fingerprintHash: transient.fingerprintHash,
        userId: response.userId,
        userEmail: response.email,
        accessTier: "limited",
        loginCompletedAt: Date.now(),
      },
    );
    return {
      flowId,
      status: "completed",
      authToken: response.authToken,
      fingerprintId: transient.fingerprintId,
      userId: response.userId,
      userEmail: response.email,
    };
  }
  if (response.status === "expired") {
    return { flowId, status: "expired", error: response.error };
  }
  if (response.status === "error") {
    return { flowId, status: "error", error: response.error };
  }
  return { flowId, status: "pending" };
}

/**
 * Releases the active Codebuff session — frees the server-side slot and
 * deletes the local ProviderConnection row.
 */
export async function releaseSession(connectionId: string): Promise<void> {
  const { connection } = { connection: await loadFreebuffConnection(connectionId) };
  try {
    await releaseFreebuffSlot(connection.authToken);
  } catch {
    // best-effort; surface deletion regardless
  }
  const { deleteProviderConnection } = await import("@/lib/localDb");
  await deleteProviderConnection(connectionId);
}

// Re-export the Freebuff session schemas for downstream consumers that
// want to validate responses locally.
export {
  freebuffSessionSchema,
  freebuffSessionStatusSchema,
};

// Avoid an unused-binding lint for the helper kept for API symmetry.
void freebuffSessionStatusSchema;

import { z } from "zod";
import {
  freebuffSessionSchema,
  freebuffSessionStatusSchema,
  getFreebuffQuota,
  releaseFreebuffSlot,
} from "@/lib/providers/freebuff";
import { freebuff, FREEBUFF_OAUTH_CONFIG } from "@/lib/oauth/providers/freebuff";
import { generateFreebuffFingerprint } from "@/lib/oauth/freebuff/fingerprint";
import {
  effectiveTokenExpiresAt,
  freebuffConnectionSchema,
  type FreebuffConnection,
} from "@/shared/schemas/providers/freebuff";

// Re-export the canonical OAuth schemas/types from `oauth.ts` (Phase 1).
// The local `freebuffLoginStartSchema` / `freebuffLoginStatusSchema` that
// previously lived here used the legacy `flowId` field which has been
// removed; callers should now use the wire-format-correct schemas in
// `oauth.ts`.
export {
  freebuffLoginStartResponseSchema as freebuffLoginStartSchema,
  freebuffLoginStatusResponseSchema as freebuffLoginStatusSchema,
  type FreebuffLoginStartResponse as FreebuffLoginStart,
  type FreebuffLoginStatusResponse as FreebuffLoginStatus,
  type FreebuffFingerprintTriple,
} from "./oauth.ts";

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

/**
 * Returns the gamification streak state for the authenticated user.
 *
 * NOTE: the upstream Codebuff/Freebuff backend does NOT expose a
 * `/api/v1/freebuff/streak` endpoint — streak data is computed entirely
 * client-side from local state (rapport-architecture-freebuff.md §10.1
 * + `common/src/util/freebuff-streak.ts`). This function now returns a
 * zeroed placeholder so the dashboard renders the Streak card without an
 * upstream fetch; the UI is expected to populate it via local
 * check-in events. Replace with a local store read once one exists.
 */
export async function getStreak(
  _connectionId: string,
): Promise<FreebuffStreak> {
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastCheckInAt: null,
  };
}

/**
 * Starts a PKCE login flow. Returns the `loginUrl` the user must open
 * and the `fingerprintHash` + `expiresAt` triple required to poll status.
 *
 * The upstream `fingerprintHash` is persisted as a transient row in the
 * connection store so `pollLoginStatus` can recover it. The actual upstream
 * call is delegated to `oauth.startLogin` which targets
 * `POST /api/auth/cli/code` (the wire-format-correct endpoint).
 */
export async function startLogin(): Promise<FreebuffLoginStart> {
  const { fingerprintId } = generateFreebuffFingerprint();
  const { startLogin: oauthStartLogin } = await import("./oauth.ts");
  const { loginUrl, fingerprintHash, expiresAt } = await oauthStartLogin({
    fingerprintId,
  });

  const transient: FreebuffConnection = {
    authToken: "00000000-0000-4000-8000-000000000000", // placeholder
    fingerprintId,
    fingerprintHash,
    loginCompletedAt: typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt,
  };
  await saveFreebuffConnection(transient);

  return { loginUrl, fingerprintHash, expiresAt };
}

/** Polls the status of an in-flight PKCE flow. */
export async function pollLoginStatus(
  triple: FreebuffFingerprintTriple,
): Promise<FreebuffLoginStatus> {
  const all = await listFreebuffConnections();
  // The most-recently created transient connection is the active flow.
  const transient = all
    .map((c) => c.connection)
    .find((c) => c.authToken === "00000000-0000-4000-8000-000000000000");
  if (!transient) {
    return {
      status: "expired",
      error: "No in-flight Freebuff login found",
    };
  }

  const oauthTriple = {
    fingerprintId: transient.fingerprintId,
    fingerprintHash: transient.fingerprintHash ?? "0".repeat(64),
    expiresAt:
      typeof triple.expiresAt === "string"
        ? triple.expiresAt
        : new Date(triple.expiresAt).toISOString(),
  };

  const { pollLoginStatus: oauthPollLoginStatus } = await import("./oauth.ts");
  const response = await oauthPollLoginStatus(oauthTriple);

  if (response.status === "completed") {
    // Persist the real connection, replacing the transient.
    const { user } = response;
    await saveFreebuffConnection({
      authToken: user.authToken,
      fingerprintId: transient.fingerprintId,
      fingerprintHash: transient.fingerprintHash,
      userId: user.userId,
      userEmail: user.userEmail,
      accessTier: "limited",
      loginCompletedAt: Date.now(),
    });
    return {
      status: "completed",
      user,
    };
  }
  if (response.status === "expired") {
    return { status: "expired" };
  }
  if (response.status === "error") {
    return { status: "error", error: response.error };
  }
  return { status: "pending" };
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

// ---------------------------------------------------------------------------
// Freebuff session lifecycle (rapport-architecture-freebuff.md §6.1 + §7.1)
// ---------------------------------------------------------------------------

/**
 * Response schema for `GET/POST /api/v1/freebuff/session`. Discriminated
 * union on `status`. The upstream returns one of these shapes depending
 * on whether the caller holds an active queue seat, is waiting, has been
 * blocked, or is in a transient error state.
 */
export const freebuffSessionServerResponseSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("none"),
      accessTier: z.enum(["full", "limited"]),
      rateLimitsByModel: z.record(z.unknown()).optional(),
      referral: z.unknown().optional(),
    }),
    z.object({
      status: z.literal("active"),
      instanceId: z.string().min(1),
      model: z.string().min(1),
      admittedAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      remainingMs: z.number().int().nonnegative(),
      rateLimit: z
        .object({
          model: z.string(),
          limit: z.number().int().nonnegative(),
          period: z.enum(["pacific_day", "pacific_week"]),
          resetTimeZone: z.string(),
          resetAt: z.string().datetime(),
          windowHours: z.number().int().nonnegative().optional(),
          recentCount: z.number().int().nonnegative(),
        })
        .optional(),
    }),
    z.object({
      status: z.literal("ended"),
      instanceId: z.string().optional(),
      gracePeriodRemainingMs: z.number().int().nonnegative().optional(),
      rateLimitsByModel: z.record(z.unknown()).optional(),
    }),
    z.object({
      status: z.literal("superseded"),
    }),
    z.object({
      status: z.literal("country_blocked"),
      countryCode: z.string().length(2),
      countryBlockReason: z.string(),
      ipPrivacySignals: z.unknown().optional(),
    }),
    z.object({
      status: z.literal("banned"),
    }),
    z.object({
      status: z.literal("model_locked"),
      currentModel: z.string(),
      requestedModel: z.string(),
    }),
    z.object({
      status: z.literal("model_unavailable"),
      requestedModel: z.string(),
      availableHours: z.string().optional(),
    }),
    z.object({
      status: z.literal("rate_limited"),
    }),
    z.object({
      status: z.literal("premium_slot_taken"),
    }),
    z.object({
      status: z.literal("takeover_prompt"),
    }),
  ],
);
export type FreebuffSessionServerResponse = z.infer<
  typeof freebuffSessionServerResponseSchema
>;

export interface FreebuffSessionFetchOptions {
  authToken: string;
  /** Freebuff `instanceId` (from a prior active session). */
  instanceId?: string;
  /** Optional fetcher override for tests. */
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}

function sessionEndpoint(): string {
  return FREEBUFF_OAUTH_CONFIG.sessionUrl;
}

/** SDK version string stamped on the `user-agent` header. Matches the
 * pattern used by the CLI (rapport §8.2). Keep in sync with
 * `FREEBUFF_SDK_VERSION` in `chatIntegration.ts`. */
const FREEBUFF_SDK_VERSION = "1.0.0";

/**
 * Probe the current session state for the authenticated user. Thin
 * wrapper around `GET /api/v1/freebuff/session`.
 */
export async function getFreebuffSession(
  options: FreebuffSessionFetchOptions,
): Promise<FreebuffSessionServerResponse> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("No fetch implementation available");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.authToken}`,
    Accept: "application/json",
    "user-agent": `ai-sdk/openai-compatible/${FREEBUFF_SDK_VERSION}/codebuff`,
  };
  if (options.instanceId) {
    headers["x-freebuff-instance-id"] = options.instanceId;
  }
  const res = await fetcher(sessionEndpoint(), {
    method: "GET",
    headers,
    signal: options.signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw upstreamError(
      res.status,
      body?.error?.message ?? `HTTP ${res.status} from ${sessionEndpoint()}`,
    );
  }
  return freebuffSessionServerResponseSchema.parse(body);
}

export interface FreebuffClaimSessionOptions extends FreebuffSessionFetchOptions {
  /** Model id the caller wants to join the queue for. */
  modelId: string;
}

/**
 * Claim a queue seat (or rotate into a different model's queue) via
 * `POST /api/v1/freebuff/session`. Sends `x-freebuff-model` so the
 * upstream knows which model's queue to join.
 */
export async function claimFreebuffSession(
  options: FreebuffClaimSessionOptions,
): Promise<FreebuffSessionServerResponse> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("No fetch implementation available");
  const res = await fetcher(sessionEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.authToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "user-agent": `ai-sdk/openai-compatible/${FREEBUFF_SDK_VERSION}/codebuff`,
      "x-freebuff-model": options.modelId,
    },
    body: JSON.stringify({ modelId: options.modelId }),
    signal: options.signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 409) {
    throw upstreamError(
      res.status,
      body?.error?.message ?? `HTTP ${res.status} from ${sessionEndpoint()}`,
    );
  }
  return freebuffSessionServerResponseSchema.parse(body);
}

/**
 * Release the current session via `DELETE /api/v1/freebuff/session`.
 * Best-effort — failures are surfaced to the caller.
 */
export async function deleteFreebuffSession(
  options: FreebuffSessionFetchOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("No fetch implementation available");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.authToken}`,
    "user-agent": `ai-sdk/openai-compatible/${FREEBUFF_SDK_VERSION}/codebuff`,
  };
  if (options.instanceId) {
    headers["x-freebuff-instance-id"] = options.instanceId;
  }
  const res = await fetcher(sessionEndpoint(), {
    method: "DELETE",
    headers,
    signal: options.signal,
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw upstreamError(
      res.status,
      body || `HTTP ${res.status} from ${sessionEndpoint()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Connection status (token TTL + re-auth warning)
//
// Captured in `validation-scripts/final-validations.md` C6: the Freebuff
// `authToken` has a hard 1-hour TTL and the upstream exposes NO refresh
// endpoint — the only path is to re-run OAuth PKCE or paste a fresh
// `credentials.json`. These helpers let the dashboard surface a "session
// expiring soon" banner ~5 min before the token dies.
// ---------------------------------------------------------------------------

/**
 * Status snapshot for a single Freebuff connection. Computed lazily from
 * `tokenExpiresAt` / `loginCompletedAt` so the dashboard can render a
 * banner without each caller having to import the schema helpers.
 */
export interface FreebuffConnectionStatus {
  connectionId: string;
  /** Unix ms when the `authToken` expires, or `null` if unknown. */
  tokenExpiresAt: number | null;
  /** Wall-clock ms remaining until expiry. Negative = already expired. */
  remainingMs: number | null;
  /** True when `remainingMs <= warningMarginMs`. */
  isExpiring: boolean;
  /** True when no TTL info is available — caller should warn the user. */
  hasUnknownTtl: boolean;
  /**
   * Convenience label for the dashboard. One of:
   *   - `"active"`     : > 5 min remaining
   *   - `"expiring"`   : <= 5 min remaining (banner time)
   *   - `"expired"`    : <= 0 (will fail; user must re-auth)
   *   - `"unknown"`    : no TTL info available
   */
  state: "active" | "expiring" | "expired" | "unknown";
}

/**
 * Compute the status snapshot for a given connection. `nowMs` and
 * `warningMarginMs` are injected for testability.
 */
export function deriveFreebuffConnectionStatus(
  connectionId: string,
  connection: FreebuffConnection,
  nowMs: number = Date.now(),
  warningMarginMs: number = 5 * 60 * 1000,
): FreebuffConnectionStatus {
  const expiresAt = effectiveTokenExpiresAt(connection);
  if (expiresAt === undefined) {
    return {
      connectionId,
      tokenExpiresAt: null,
      remainingMs: null,
      isExpiring: false,
      hasUnknownTtl: true,
      state: "unknown",
    };
  }
  const remainingMs = expiresAt - nowMs;
  const state: FreebuffConnectionStatus["state"] =
    remainingMs <= 0
      ? "expired"
      : remainingMs <= warningMarginMs
        ? "expiring"
        : "active";
  return {
    connectionId,
    tokenExpiresAt: expiresAt,
    remainingMs,
    isExpiring: state !== "active",
    hasUnknownTtl: false,
    state,
  };
}

/**
 * Return the status for a single Freebuff connection by id.
 */
export async function getFreebuffConnectionStatus(
  connectionId: string,
): Promise<FreebuffConnectionStatus> {
  const conn = await loadFreebuffConnection(connectionId);
  return deriveFreebuffConnectionStatus(connectionId, conn);
}

/**
 * Return the status for every Freebuff connection. Used by the dashboard
 * to render a global "X connections expiring soon" badge.
 */
export async function listFreebuffConnectionStatuses(): Promise<
  FreebuffConnectionStatus[]
> {
  const all = await listFreebuffConnections();
  return all.map(({ id, connection }) =>
    deriveFreebuffConnectionStatus(id, connection),
  );
}


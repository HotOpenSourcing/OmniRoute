import { z } from "zod";
import { FREEBUFF_OAUTH_CONFIG } from "@/lib/oauth/providers/freebuff";

/**
 * Freebuff quota + waiting-room client.
 *
 * Wraps `GET /api/v1/freebuff/session` (state machine) and
 * `GET /api/v1/freebuff/streak` (gamification).
 *
 * Both endpoints require an Authorization Bearer token (the
 * `authToken` from the credentials.json / PKCE flow).
 *
 * @module lib/providers/freebuff/quota
 */

const baseUrl = (): string => FREEBUFF_OAUTH_CONFIG.sessionUrl.replace(
  /\/api\/v1\/freebuff\/session$/,
  "",
);

export const freebuffSessionStatusSchema = z.enum([
  "none",
  "queued",
  "active",
  "ended",
  "superseded",
  "takeover_prompt",
  "country_blocked",
  "banned",
  "rate_limited",
  "model_locked",
  "model_unavailable",
  "disabled",
]);
export type FreebuffSessionStatus = z.infer<typeof freebuffSessionStatusSchema>;

export const freebuffAccessTierSchema = z.enum(["full", "limited"]);
export type FreebuffAccessTier = z.infer<typeof freebuffAccessTierSchema>;

export const freebuffSessionSchema = z
  .object({
    status: freebuffSessionStatusSchema,
    accessTier: freebuffAccessTierSchema.optional(),
    queueDepthByModel: z.record(z.string(), z.number()).optional(),
    rateLimitsByModel: z.record(z.string(), z.unknown()).optional(),
    referral: z
      .object({
        code: z.string().optional(),
        referrerName: z.string().optional(),
        qualifiedCount: z.number().optional(),
        weeklySessionsRemaining: z.number().optional(),
        githubLinked: z.boolean().optional(),
        resetAt: z.string().optional(),
      })
      .optional(),
    countryCode: z.string().optional(),
    countryBlockReason: z.string().optional(),
    ipPrivacySignals: z.array(z.string()).optional(),
    position: z.number().optional(),
    queueDepth: z.number().optional(),
    estimatedWaitMs: z.number().optional(),
    queuedAt: z.string().optional(),
    model: z.string().optional(),
    currentModel: z.string().optional(),
    recentCount: z.number().optional(),
    limit: z.number().optional(),
    retryAfterMs: z.number().optional(),
    instanceId: z.string().optional(),
    remainingMs: z.number().optional(),
    expiresAt: z.number().optional(),
  })
  .passthrough();

export type FreebuffSession = z.infer<typeof freebuffSessionSchema>;

export const freebuffStreakSchema = z.object({
  streak: z.number().int().nonnegative(),
});

export type FreebuffStreak = z.infer<typeof freebuffStreakSchema>;

export interface FreebuffQuotaSnapshot {
  /** Parsed session state. */
  session: FreebuffSession;
  /** Streak days, or null if the streak endpoint failed / returned non-OK. */
  streak: number | null;
  /** True when the session is rate-limited (limit reached). */
  isLimited: boolean;
  /** True when the session is blocked (country/VPN/banned). */
  isBlocked: boolean;
  /** True when the user is waiting in the queue. */
  isQueued: boolean;
  /** True when the session is actively running (can send prompts). */
  isActive: boolean;
}

export interface GetFreebuffQuotaOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Skip the streak endpoint (e.g. when quota is high and streak is noisy). */
  includeStreak?: boolean;
  /**
   * Optional fingerprint triple for the headers `x-codebuff-fingerprint` /
   * `x-codebuff-fingerprint-hash`. The upstream does not validate these
   * (see `final-validations.md` Mission 1) but they match the SDK
   * contract used by the production CLI binary, so we send them when
   * the credentials carry a fingerprint triple.
   */
  fingerprint?: { fingerprintId: string; fingerprintHash?: string };
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

/**
 * Thrown when the upstream Freebuff/Codebuff API rejects the auth token
 * with HTTP 401 "Invalid API key". Per `final-validations.md` finding
 * **C6**, the `authToken` has a TTL of ~1 hour; when this fires, the
 * caller MUST trigger a re-auth flow (`relogin.ts`, ~6 min) — there is
 * no refresh-token endpoint.
 */
export class FreebuffAuthError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number = 401,
  ) {
    super(message);
    this.name = "FreebuffAuthError";
  }
}

/**
 * Fetch the current waiting-room session + (optional) streak.
 *
 * Both endpoints are GET. Headers: `Authorization: Bearer <authToken>`
 * plus `x-freebuff-instance-id` for the session poll (when known).
 *
 * Errors are swallowed for the streak endpoint so the UI still gets a
 * usable session snapshot. Network failures on the session endpoint
 * are propagated.
 */
export async function getFreebuffQuota(
  authToken: string,
  instanceId?: string,
  options: GetFreebuffQuotaOptions = {},
): Promise<FreebuffQuotaSnapshot> {
  const doFetch = options.fetchImpl ?? fetch;
  const includeStreak = options.includeStreak !== false;

  const sessionHeaders: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json",
  };
  if (instanceId) sessionHeaders["x-freebuff-instance-id"] = instanceId;
  if (options.fingerprint?.fingerprintId) {
    sessionHeaders["x-codebuff-fingerprint"] = options.fingerprint.fingerprintId;
  }
  if (options.fingerprint?.fingerprintHash) {
    sessionHeaders["x-codebuff-fingerprint-hash"] = options.fingerprint.fingerprintHash;
  }

  const sessionRes = await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
    method: "GET",
    headers: sessionHeaders,
    signal: options.signal,
  });

  // Per C6: 401 means the auth token expired (TTL ~1h). Surface as a
  // typed error so callers can route to a re-auth flow rather than
  // retrying blindly.
  if (sessionRes.status === 401) {
    throw new FreebuffAuthError(
      `freebuff.getFreebuffQuota: HTTP 401 from ${baseUrl()}/api/v1/freebuff/session — auth token expired, re-auth required`,
    );
  }
  if (!sessionRes.ok) {
    throw new Error(
      `freebuff.getFreebuffQuota: session fetch failed: HTTP ${sessionRes.status}`,
    );
  }

  const sessionJson = await sessionRes.json().catch(() => ({}));
  const sessionParsed = freebuffSessionSchema.safeParse(sessionJson);
  if (!sessionParsed.success) {
    throw new Error(
      `freebuff.getFreebuffQuota: session response did not match schema: ${sessionParsed.error.message}`,
    );
  }
  const session = sessionParsed.data;

  let streak: number | null = null;
  if (includeStreak) {
    try {
      const streakHeaders: Record<string, string> = {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
      };
      if (options.fingerprint?.fingerprintId) {
        streakHeaders["x-codebuff-fingerprint"] = options.fingerprint.fingerprintId;
      }
      if (options.fingerprint?.fingerprintHash) {
        streakHeaders["x-codebuff-fingerprint-hash"] = options.fingerprint.fingerprintHash;
      }
      const streakRes = await doFetch(`${baseUrl()}/api/v1/freebuff/streak`, {
        method: "GET",
        headers: streakHeaders,
        signal: options.signal,
      });
      // 401 on streak is best-effort (we don't want a stale auth state
      // to poison the session snapshot). Swallow and let the caller
      // re-check via `getFreebuffQuota` to see the FreebuffAuthError.
      if (streakRes.ok) {
        const streakJson = await streakRes.json().catch(() => ({}));
        const streakParsed = freebuffStreakSchema.safeParse(streakJson);
        if (streakParsed.success) streak = streakParsed.data.streak;
      }
    } catch {
      // streak is best-effort; swallow
    }
  }

  return {
    session,
    streak,
    isLimited:
      session.status === "rate_limited" ||
      session.status === "model_locked" ||
      session.status === "model_unavailable",
    isBlocked:
      session.status === "country_blocked" || session.status === "banned",
    isQueued: session.status === "queued",
    isActive:
      session.status === "active" ||
      session.status === "ended" || // ended sessions may still allow one final prompt
      session.status === "none", // no session yet → can start one
  };
}

/**
 * Acquire a freebuff waiting-room slot via POST /session.
 * Returns the session ID if assigned.
 *
 * Status mapping (final-validations.md §1 + §2 + C4 + C8):
 *
 *   - 200        → `{ status: "active", instanceId }`
 *   - 401        → throws `FreebuffAuthError` (C6 — authToken TTL ~1h)
 *   - 403        → `{ status: "country_blocked" | "banned" }`
 *   - 404        → `{ status: "disabled" }` (Freebuff rolled out / deprecated)
 *   - 409        → `{ status: "model_locked" | "model_unavailable" }`
 *                  (concurrent session for the same model, or the
 *                  account's tier does not allow this model)
 *   - 429        → `{ status: "rate_limited" }`
 *
 * The `superseded` and `premium_slot_taken` statuses are observed only
 * on the *previous* session (the server transitions an active row to
 * `superseded` the moment a new POST arrives, see C8). They never
 * surface as a fresh POST response — `acquireFreebuffSlot` returns the
 * new `active` row. Callers detect those via `getFreebuffQuota` polls.
 */
export async function acquireFreebuffSlot(
  authToken: string,
  modelId: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** Optional fingerprint triple for the SDK contract headers. */
    fingerprint?: { fingerprintId: string; fingerprintHash?: string };
  } = {},
): Promise<{
  status: FreebuffSessionStatus;
  instanceId?: string;
  expiresAt?: number;
  remainingMs?: number;
}> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "x-freebuff-model": modelId,
    Accept: "application/json",
  };
  if (options.fingerprint?.fingerprintId) {
    headers["x-codebuff-fingerprint"] = options.fingerprint.fingerprintId;
  }
  if (options.fingerprint?.fingerprintHash) {
    headers["x-codebuff-fingerprint-hash"] = options.fingerprint.fingerprintHash;
  }

  const res = await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
    method: "POST",
    headers,
    signal: options.signal,
  });
  if (res.status === 401) {
    throw new FreebuffAuthError(
      `freebuff.acquireFreebuffSlot: HTTP 401 — auth token expired, re-auth required`,
    );
  }
  if (res.status === 404) return { status: "disabled" };
  if (res.status === 403) {
    const body = await res.json().catch(() => null);
    if (body?.status === "country_blocked" || body?.status === "banned") {
      return { status: body.status };
    }
  }
  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    if (body?.status === "model_locked" || body?.status === "model_unavailable") {
      return { status: body.status };
    }
  }
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    if (body?.status === "rate_limited") return { status: "rate_limited" };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `freebuff.acquireFreebuffSlot failed: HTTP ${res.status} ${body.slice(0, 200)}`,
    );
  }
  const json = await res.json().catch(() => ({}));
  const parsed = freebuffSessionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `freebuff.acquireFreebuffSlot: response did not match schema`,
    );
  }
  return {
    status: parsed.data.status,
    instanceId: parsed.data.instanceId,
    expiresAt: parsed.data.expiresAt,
    remainingMs: parsed.data.remainingMs,
  };
}

/**
 * Release a freebuff waiting-room slot via DELETE /session.
 * Best-effort: failures are swallowed (matches the SDK binary's
 * behaviour, where release on stream-close is fire-and-forget).
 */
export async function releaseFreebuffSlot(
  authToken: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    /** The instance being released — forwarded as `x-freebuff-instance-id`
     *  so the server can match the right row (defensive: without it the
     *  server treats the DELETE as a wildcard sweep). */
    instanceId?: string;
    fingerprint?: { fingerprintId: string; fingerprintHash?: string };
  } = {},
): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
  };
  if (options.instanceId) headers["x-freebuff-instance-id"] = options.instanceId;
  if (options.fingerprint?.fingerprintId) {
    headers["x-codebuff-fingerprint"] = options.fingerprint.fingerprintId;
  }
  if (options.fingerprint?.fingerprintHash) {
    headers["x-codebuff-fingerprint-hash"] = options.fingerprint.fingerprintHash;
  }
  try {
    await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
      method: "DELETE",
      headers,
      signal: options.signal,
    });
  } catch {
    // best-effort
  }
}

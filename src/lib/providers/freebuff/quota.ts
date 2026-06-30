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

  const sessionRes = await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
    method: "GET",
    headers: sessionHeaders,
    signal: options.signal,
  });

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
      const streakRes = await doFetch(`${baseUrl()}/api/v1/freebuff/streak`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/json",
        },
        signal: options.signal,
      });
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
 */
export async function acquireFreebuffSlot(
  authToken: string,
  modelId: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<{ status: FreebuffSessionStatus; instanceId?: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "x-freebuff-model": modelId,
      Accept: "application/json",
    },
    signal: options.signal,
  });
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
  };
}

/**
 * Release a freebuff waiting-room slot via DELETE /session.
 * Best-effort: failures are swallowed.
 */
export async function releaseFreebuffSlot(
  authToken: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    await doFetch(`${baseUrl()}/api/v1/freebuff/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
      signal: options.signal,
    });
  } catch {
    // best-effort
  }
}

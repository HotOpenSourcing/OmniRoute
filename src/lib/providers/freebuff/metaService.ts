/**
 * Freebuff provider meta-service.
 *
 * Exposes the contract used by the `/api/v1/providers/freebuff/*` route
 * handlers. The actual implementations depend on the provider layer
 * (Chunk 4: session lock, OAuth, fingerprint, request orchestration) and
 * on the persisted connection store (chunks 1 / 4).
 *
 * STATUS — STUBS
 * --------------
 * Every function in this file currently throws `Error` with a stable
 * message so the route handlers can return a clean 501 to the client.
 * Once Chunk 4 lands, these become thin wrappers over the provider
 * implementation. The function signatures and the response shapes
 * (`FreebuffQuotaState`, `FreebuffStreak`, `FreebuffLoginStart`,
 * `FreebuffLoginStatus`) are stable — they are the public contract the
 * dashboard consumes.
 */

import { z } from "zod";

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
  flowId: z.string().uuid(),
  /** URL the user must open in a browser to complete PKCE. */
  loginUrl: z.string().url(),
  /** ISO-8601 timestamp after which the flow expires. */
  expiresAt: z.string().datetime(),
});
export type FreebuffLoginStart = z.infer<typeof freebuffLoginStartSchema>;

export const freebuffLoginStatusSchema = z.object({
  flowId: z.string().uuid(),
  status: z.enum(["pending", "completed", "expired", "error"]),
  /** Populated when status === "completed". */
  authToken: z.string().uuid().optional(),
  fingerprintId: z
    .string()
    .regex(/^enhanced-[A-Za-z0-9_-]{43}$/)
    .optional(),
  userId: z.string().uuid().optional(),
  userEmail: z.string().email().optional(),
  /** Human-readable error when status === "error". */
  error: z.string().optional(),
});
export type FreebuffLoginStatus = z.infer<typeof freebuffLoginStatusSchema>;

// ---------------------------------------------------------------------------
// Implementation stubs — filled by Chunk 4.
// ---------------------------------------------------------------------------

/** Sentinel thrown by every stub so callers can map to HTTP 501. */
export const NOT_IMPLEMENTED_ERROR =
  "freebuff metaService not implemented — see Chunk 4 (provider)";

/**
 * Returns the current quota state for the authenticated user.
 *
 * Chunk 4 will read this from the persisted connection + the latest
 * snapshot fetched from Codebuff.
 */
export async function getQuotaState(): Promise<FreebuffQuotaState> {
  throw new Error(NOT_IMPLEMENTED_ERROR);
}

/** Returns the gamification streak state for the authenticated user. */
export async function getStreak(): Promise<FreebuffStreak> {
  throw new Error(NOT_IMPLEMENTED_ERROR);
}

/**
 * Starts a PKCE login flow. Returns the `loginUrl` the user must open
 * and a `flowId` to poll status with.
 */
export async function startLogin(): Promise<FreebuffLoginStart> {
  throw new Error(NOT_IMPLEMENTED_ERROR);
}

/** Polls the status of an in-flight PKCE flow. */
export async function pollLoginStatus(
  _flowId: string,
): Promise<FreebuffLoginStatus> {
  throw new Error(NOT_IMPLEMENTED_ERROR);
}

/**
 * Releases the active Codebuff session — frees the PID-file lock so
 * another process (or another OmniRoute instance) can claim the slot.
 */
export async function releaseSession(): Promise<void> {
  throw new Error(NOT_IMPLEMENTED_ERROR);
}

// ---------------------------------------------------------------------------
// Error classifier (used by route handlers to map exceptions to HTTP).
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

/** Convenience: build a 401 error for unauthenticated requests. */
export function unauthorizedError(message = "Authentication required"): FreebuffMetaError {
  return new FreebuffMetaError(message, 401, "unauthorized");
}

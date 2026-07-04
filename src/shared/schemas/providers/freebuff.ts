import { z } from "zod";

/**
 * Freebuff (Codebuff) provider connection schema.
 *
 * Validates the persisted connection record. The hardware fingerprint may
 * not match between the OmniRoute server and the user's local CLI when
 * OmniRoute runs in Docker/cloud. The UI surfaces this as a warning and
 * recommends the "paste credentials.json" fallback in that case.
 *
 * @module shared/schemas/providers/freebuff
 */

/**
 * Lenient UUID check for the Freebuff provider.
 *
 * The Codebuff binary emits UUIDs, but we keep validation loose enough
 * to accept any RFC-4122-shaped identifier regardless of version/variant
 * bits. This keeps the provider resilient to future server changes and
 * avoids rejecting the deterministic fixtures used in unit tests.
 */
export const freebuffUuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    "Invalid UUID",
  );

const uuid = freebuffUuidSchema;
const enhancedFingerprint = z.string().regex(
  /^enhanced-[A-Za-z0-9_-]{43}$/,
  "fingerprintId must match /^enhanced-[A-Za-z0-9_-]{43}$/",
);
const optionalEnhancedFingerprint = enhancedFingerprint.optional();

export const freebuffConnectionSchema = z.object({
  authToken: uuid,
  fingerprintId: enhancedFingerprint,
  fingerprintHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "fingerprintHash must be a 64-char hex sha256")
    .optional(),
  instanceId: uuid.optional(),
  userId: uuid.optional(),
  userEmail: z.string().email().optional().or(z.literal("")),
  accessTier: z.enum(["full", "limited"]).optional(),
  selectedModel: z.string().min(1).optional(),
  /** Unix ms when the OAuth PKCE flow completed (i.e. token was issued). */
  loginCompletedAt: z.number().int().positive().optional(),
  /**
   * Unix ms when the `authToken` expires. Tracked so the dashboard can
   * warn the user ~5 min before expiry and prompt a re-authentication
   * via the FreebuffOAuthWrapper. Captured in v3.8.43 — for older
   * connections it is derived from `loginCompletedAt + 1h` by
   * `effectiveTokenExpiresAt`.
   */
  tokenExpiresAt: z.number().int().positive().optional(),
});

/**
 * The Freebuff `authToken` has a hard 1-hour TTL — verified by
 * `validation-scripts/final-validations.md` C5/C6. The upstream does
 * NOT expose a refresh endpoint; the only path is to re-run the OAuth
 * PKCE polling (browser flow) or paste a fresh `credentials.json`.
 *
 * This constant is the single source of truth — used by the connection
 * schema, the seat cache, the dashboard banner, and any future
 * proactive-refresh scheduler. Bump it if Codebuff ever changes the TTL.
 */
export const FREEBUFF_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Resolve the effective expiry for a connection, checking in this order:
 *   1. `tokenExpiresAt` (top-level — set by `mapTokens` for new connections).
 *   2. `providerSpecificData.tokenExpiresAt` (legacy storage path —
 *      older `createProviderConnection` spreads kept it inside the
 *      provider-specific JSON blob).
 *   3. `loginCompletedAt + FREEBUFF_TOKEN_TTL_MS` (best-effort fallback
 *      for connections persisted before the TTL column was added).
 * Returns `undefined` if none of the above are available (the caller
 * should treat that as "unknown" and surface a warning rather than
 * block the connection).
 */
export function effectiveTokenExpiresAt(
  connection: FreebuffConnection,
): number | undefined {
  if (typeof connection.tokenExpiresAt === "number") {
    return connection.tokenExpiresAt;
  }
  const fromProviderSpecific =
    typeof connection.providerSpecificData === "object" &&
    connection.providerSpecificData !== null &&
    typeof (connection.providerSpecificData as Record<string, unknown>)
      .tokenExpiresAt === "number"
      ? ((connection.providerSpecificData as Record<string, unknown>)
          .tokenExpiresAt as number)
      : undefined;
  if (fromProviderSpecific !== undefined) return fromProviderSpecific;
  if (typeof connection.loginCompletedAt === "number") {
    return connection.loginCompletedAt + FREEBUFF_TOKEN_TTL_MS;
  }
  return undefined;
}

/**
 * Convenience predicate used by the dashboard banner. Returns true when
 * the token expires within the given margin (default 5 min). An
 * `undefined` expiry returns `false` — the banner then surfaces an
 * "unknown TTL" warning instead.
 */
export function isFreebuffTokenExpiringSoon(
  connection: FreebuffConnection,
  marginMs: number = 5 * 60 * 1000,
  nowMs: number = Date.now(),
): boolean {
  const expiresAt = effectiveTokenExpiresAt(connection);
  if (expiresAt === undefined) return false;
  return expiresAt - marginMs <= nowMs;
}

export type FreebuffConnection = z.infer<typeof freebuffConnectionSchema>;

export function parseFreebuffConnection(input: unknown): FreebuffConnection {
  return freebuffConnectionSchema.parse(input);
}

export function safeParseFreebuffConnection(input: unknown) {
  return freebuffConnectionSchema.safeParse(input);
}

// Re-export for consumers that want to validate just the fingerprint id.
export { enhancedFingerprint, optionalEnhancedFingerprint };

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
  loginCompletedAt: z.number().int().positive().optional(),
});

export type FreebuffConnection = z.infer<typeof freebuffConnectionSchema>;

export function parseFreebuffConnection(input: unknown): FreebuffConnection {
  return freebuffConnectionSchema.parse(input);
}

export function safeParseFreebuffConnection(input: unknown) {
  return freebuffConnectionSchema.safeParse(input);
}

// Re-export for consumers that want to validate just the fingerprint id.
export { enhancedFingerprint, optionalEnhancedFingerprint };

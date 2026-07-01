/**
 * Freebuff (Codebuff) provider — public surface.
 *
 * This barrel re-exports everything other layers (HTTP routes, UI,
 * transformers) need to consume the provider. Importing from
 * `@/lib/providers/freebuff` is the recommended entry point.
 *
 * @module lib/providers/freebuff
 */

export {
  // ─── base ────────────────────────────────────────────────────────
  FREEBUFF_CODEBUFF_BASE_URL,
  FREEBUFF_FREEBUFF_BASE_URL,
  FREEBUFF_TIER_ENV,
  FREEBUFF_ENABLED_ENV,
  FREEBUFF_CREDENTIALS_PATH_ENV,
  FREEBUFF_DEFAULT_CREDENTIALS_PATH,
  FREEBUFF_ANTHROPIC_PATH,
  FREEBUFF_OPENAI_PATH,
  resolveFreebuffBaseUrl,
  isFreebuffEnabled,
  resolveFreebuffCredentialsPath,
} from "./base";

// ─── quota ─────────────────────────────────────────────────────────
export {
  freebuffSessionStatusSchema,
  freebuffAccessTierSchema,
  freebuffSessionSchema,
  freebuffStreakSchema,
  getFreebuffQuota,
  acquireFreebuffSlot,
  releaseFreebuffSlot,
  type FreebuffSessionStatus,
  type FreebuffAccessTier,
  type FreebuffSession,
  type FreebuffStreak,
  type FreebuffQuotaSnapshot,
  type GetFreebuffQuotaOptions,
} from "./quota";

// ─── lock ──────────────────────────────────────────────────────────
export {
  FREEBUFF_LOCK_PATH_ENV,
  FREEBUFF_DEFAULT_LOCK_PATH,
  isPidAlive,
  resolveFreebuffLockPath,
  readFreebuffLock,
  acquireFreebuffLock,
  releaseFreebuffLock,
  inspectFreebuffLock,
  type FreebuffLockResult,
  type FreebuffLockRecord,
} from "./lock";

// ─── registry ──────────────────────────────────────────────────────
export {
  FREEBUFF_OPENAI_CHAT_PATH,
  FREEBUFF_ANTHROPIC_MESSAGES_PATH,
  getFreebuffProviderConfig,
  getFreebuffOpenAIEndpoint,
  getFreebuffAnthropicEndpoint,
  type FreebuffProviderConfig,
} from "./registry";

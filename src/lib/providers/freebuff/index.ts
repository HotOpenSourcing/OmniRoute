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
  FreebuffAuthError,
  type FreebuffSessionStatus,
  type FreebuffAccessTier,
  type FreebuffSession,
  type FreebuffStreak,
  type FreebuffQuotaSnapshot,
  type GetFreebuffQuotaOptions,
} from "./quota";

// ─── session manager ──────────────────────────────────────────────
export {
  freebuffSessionManager,
  FreebuffSessionManager,
  FreebuffSessionManagerError,
  FREEBUFF_DEFAULT_REFRESH_LEAD_MS,
  FREEBUFF_DEFAULT_TTL_MS,
  type SessionEntry,
  type SessionManagerOptions,
  type AcquireSessionArgs,
  type SessionManagerErrorCode,
} from "./sessionManager";

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

// ─── seat cache (1-hour session cache for chat-completions) ───────
export {
  ensureFreebuffSeat,
  invalidateFreebuffSeat,
  getFreebuffSeatCacheSize,
  withFreebuffChatLock,
  getFreebuffChatLockCount,
  type FreebuffSeat,
  type EnsureFreebuffSeatOptions,
} from "./seatCache";

// ─── connection status (token TTL + re-auth warning) ──────────────
export {
  deriveFreebuffConnectionStatus,
  getFreebuffConnectionStatus,
  listFreebuffConnectionStatuses,
  type FreebuffConnectionStatus,
} from "./metaService";

// ─── connection schema (token TTL constants + helpers) ────────────
export {
  FREEBUFF_TOKEN_TTL_MS,
  effectiveTokenExpiresAt,
  isFreebuffTokenExpiringSoon,
} from "@/shared/schemas/providers/freebuff";

// ─── registry ──────────────────────────────────────────────────────
export {
  FREEBUFF_OPENAI_CHAT_PATH,
  FREEBUFF_ANTHROPIC_MESSAGES_PATH,
  getFreebuffProviderConfig,
  getFreebuffOpenAIEndpoint,
  getFreebuffAnthropicEndpoint,
  type FreebuffProviderConfig,
} from "./registry";

// ─── chat orchestrator ─────────────────────────────────────────────
export {
  sendFreebuffChat,
  sendFreebuffChatOnce,
  FreebuffChatRequestError,
  FREEBUFF_SDK_VERSION,
  FREEBUFF_USER_AGENT,
  buildFreebuffChatBody,
  buildFreebuffChatHeaders,
  type FreebuffChatRequest,
  type FreebuffChatBodyInput,
} from "./chat";

// ─── pass-through transformer ──────────────────────────────────────
export {
  createPassthroughTransformer,
  type PassThroughOptions,
} from "./stream/passthroughTransformer";

// ─── agent-runs handshake ────────────────────────────────────────
export {
  FREEBUFF_AGENT_RUNS_PATH,
} from "./base";
export {
  FreebuffProviderError,
  buildFreebuffHeaders,
  startAgentRun,
  finishAgentRun,
  type FreebuffCredentials,
  type StartAgentRunParams,
  type FinishAgentRunParams,
  type FinishAgentRunStatus,
} from "./agentRuns";

// ─── model → agentId mapping ──────────────────────────────────────
export {
  getFreebuffAgentId,
  listFreebuffMappedModels,
  generateFreebuffRequestId,
} from "./agentMapping";

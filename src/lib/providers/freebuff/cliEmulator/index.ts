/**
 * Freebuff CLI Emulator — Public Barrel
 *
 * Re-exports the public surface of the emulator so callers can import
 * everything from a single path:
 *
 *   import { emulateChat, buildFallbackChain } from "@/lib/providers/freebuff/cliEmulator";
 *
 * @module lib/providers/freebuff/cliEmulator
 */

// ─── Types ───────────────────────────────────────────────────────────
export type {
  FreebuffTier,
  FreebuffModelDescriptor,
  FreebuffCredentials,
  FreebuffSession,
  FreebuffRateLimit,
  FreebuffAgentRun,
  FreebuffWireEnvelope,
  FreebuffHeaders,
  FreebuffSseEvent,
  FreebuffChatInput,
  FreebuffChatContext,
  FreebuffHttpClient,
  FreebuffHttpRequest,
  FreebuffHttpResponse,
  FreebuffSessionManager,
  FreebuffAgentRunner,
} from "./types.ts";

export {
  FreebuffError,
  FreebuffAuthError,
  FreebuffCliRequiredError,
  FreebuffInvalidAgentModelError,
  FreebuffCountryBlockedError,
  FreebuffModelLockedError,
  FreebuffSessionError,
} from "./types.ts";

// ─── Model registry ──────────────────────────────────────────────────
export {
  FREEBUFF_MODELS,
  getModelDescriptor,
  getAgentForModel,
  getModelsByTier,
  getLimitedTierModels,
  getPremiumTierModels,
  isKnownModel,
  stripProviderPrefix,
} from "./modelRegistry.ts";

// ─── HTTP client ─────────────────────────────────────────────────────
export {
  DEFAULT_TLS_CLIENT_IDENTIFIER,
  createHttpClient,
  getHttpClientBackendName,
} from "./httpClient.ts";

// ─── Session manager ─────────────────────────────────────────────────
export {
  FREEBUFF_BASE_URL,
  sessionEndpoint,
  createSessionManager,
} from "./sessionManager.ts";

// ─── Agent runner ────────────────────────────────────────────────────
export { agentRunsEndpoint, createAgentRunner } from "./agentRunner.ts";

// ─── Envelope builder ────────────────────────────────────────────────
export {
  USER_AGENT,
  buildHeaders,
  buildEnvelope,
  generateClientId,
  generateUserInputId,
  resolveProviderOrder,
} from "./envelopeBuilder.ts";

// ─── SSE parser ──────────────────────────────────────────────────────
export { CodebuffSseParser, parseSseStream } from "./sseParser.ts";
export type { CodebuffEvent } from "../stream/parser.ts";

// ─── Fallback chain ──────────────────────────────────────────────────
export {
  classifyError,
  buildFallbackChain,
  nextCandidate,
} from "./fallbackChain.ts";
export type {
  FallbackTier,
  FallbackCandidate,
  FallbackDecision,
} from "./fallbackChain.ts";

// ─── Main orchestrator ───────────────────────────────────────────────
export {
  emulateChat,
  FreebuffChainExhaustedError,
} from "./emulateChat.ts";
export type { EmulateChatOptions, EmulateChatResult } from "./emulateChat.ts";

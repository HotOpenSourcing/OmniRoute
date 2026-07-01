/**
 * Freebuff (Codebuff) provider base constants and configuration.
 *
 * The provider targets https://codebuff.com (paid tier) or
 * https://freebuff.com (free tier with queue). Most users will use the
 * free tier — the waiting room + quotas are enforced server-side.
 *
 * @module lib/providers/freebuff/base
 */

import { homedir } from "node:os";

/** Codebuff (paid) base URL. */
export const FREEBUFF_CODEBUFF_BASE_URL = "https://codebuff.com";

/** Freebuff (free) base URL. Use this for the public free tier. */
export const FREEBUFF_FREEBUFF_BASE_URL = "https://freebuff.com";

/** Env var to switch between free and paid tier (default: free). */
export const FREEBUFF_TIER_ENV = "FREEBUFF_TIER";

/** Env var to opt-in to the provider (default: off). */
export const FREEBUFF_ENABLED_ENV = "FREEBUFF_ENABLED";

/** Env var for the credentials.json path used by the paste fallback. */
export const FREEBUFF_CREDENTIALS_PATH_ENV = "FREEBUFF_CREDENTIALS_PATH";

/** Default credentials.json path (the manicode config dir). */
export const FREEBUFF_DEFAULT_CREDENTIALS_PATH =
  "~/.config/manicode/credentials.json";

/** Default Anthropic-compat base URL suffix used by Codebuff (set in Chunk 5/7). */
export const FREEBUFF_ANTHROPIC_PATH = "/api/v1/anthropic/v1/messages";

/** Default OpenAI-compat base URL suffix used by Codebuff. */
export const FREEBUFF_OPENAI_PATH = "/api/v1/openai/v1/chat/completions";

/**
 * Resolve the API base URL based on FREEBUFF_TIER env var.
 *
 *   "free" (default)  → https://freebuff.com
 *   "codebuff"        → https://codebuff.com
 */
export function resolveFreebuffBaseUrl(): string {
  const tier = process.env[FREEBUFF_TIER_ENV];
  if (tier === "codebuff" || tier === "paid") return FREEBUFF_CODEBUFF_BASE_URL;
  return FREEBUFF_FREEBUFF_BASE_URL;
}

/**
 * Returns true only if the provider is explicitly opted-in.
 * Default is OFF — freebuff is opt-in per plan constraint C4.
 */
export function isFreebuffEnabled(): boolean {
  const v = process.env[FREEBUFF_ENABLED_ENV];
  return v === "1" || v === "true";
}

/**
 * Resolve the credentials.json path. Supports `~` expansion (basic,
 * only for the literal "~/" or "~" prefix).
 */
export function resolveFreebuffCredentialsPath(): string {
  const raw =
    process.env[FREEBUFF_CREDENTIALS_PATH_ENV] ??
    FREEBUFF_DEFAULT_CREDENTIALS_PATH;
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) {
    return homedir() + raw.slice(1);
  }
  return raw;
}

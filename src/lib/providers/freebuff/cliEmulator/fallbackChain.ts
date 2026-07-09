/**
 * Freebuff CLI Emulator — Fallback Chain
 *
 * Implements the tiered fallback strategy for the Codebuff/Freebuff
 * free tier. When a premium model is unavailable (geo-blocked, agent
 * not allowed, rate-limited, etc.), the chain walks down through:
 *
 *   premium  →  limited  →  legacy
 *
 * Within a tier, models are tried in declaration order (see
 * `modelRegistry.ts`). The chain stops as soon as one model succeeds
 * or when all candidates are exhausted.
 *
 * Error classification:
 *   - `FreebuffCountryBlockedError` → fall back to limited tier
 *   - `FreebuffInvalidAgentModelError` → skip to next model in tier
 *   - `FreebuffSessionError` (5xx) → retry once, then skip
 *   - `FreebuffAuthError` (401) → abort (re-auth required)
 *   - any other error �� skip to next model
 *
 * @module lib/providers/freebuff/cliEmulator/fallbackChain
 */

import {
  getLimitedTierModels,
  getModelDescriptor,
  getPremiumTierModels,
  type FreebuffModelDescriptor as _FreebuffModelDescriptor,
} from "./modelRegistry.ts";
import type { FreebuffModelDescriptor } from "./types.ts";
import {
  FreebuffAuthError,
  FreebuffCountryBlockedError,
  FreebuffInvalidAgentModelError,
  FreebuffSessionError,
} from "./types.ts";

export type FallbackTier = "premium" | "limited" | "legacy";

/**
 * A single candidate in the fallback chain. Carries enough context for
 * the orchestrator to attempt a chat without re-resolving the model.
 */
export interface FallbackCandidate {
  readonly tier: FallbackTier;
  readonly model: FreebuffModelDescriptor;
}

/**
 * Result of classifying an error against the fallback policy.
 */
export type FallbackDecision =
  | { action: "abort"; reason: string }
  | { action: "retry-same"; reason: string }
  | { action: "next-model"; reason: string }
  | { action: "downgrade-tier"; reason: string };

/**
 * Classify an error against the fallback policy. The orchestrator uses
 * this to decide whether to retry the same model, skip to the next
 * model in the same tier, downgrade to the next tier, or abort.
 */
export function classifyError(err: unknown): FallbackDecision {
  if (err instanceof FreebuffAuthError) {
    return { action: "abort", reason: "authentication required" };
  }
  if (err instanceof FreebuffCountryBlockedError) {
    return {
      action: "downgrade-tier",
      reason: `country blocked: ${err.countryCode ?? "unknown"}`,
    };
  }
  if (err instanceof FreebuffInvalidAgentModelError) {
    return {
      action: "next-model",
      reason: `invalid agent/model: ${err.agent ?? "?"}/${err.model ?? "?"}`,
    };
  }
  if (err instanceof FreebuffSessionError) {
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      return { action: "abort", reason: `auth error: ${err.httpStatus}` };
    }
    if (err.httpStatus === 429) {
      return { action: "retry-same", reason: "rate limited" };
    }
    if (err.httpStatus !== undefined && err.httpStatus >= 500) {
      return { action: "retry-same", reason: `upstream ${err.httpStatus}` };
    }
    return { action: "next-model", reason: `session error: ${err.httpStatus ?? "?"}` };
  }
  // Unknown error — skip to next model.
  const message = err instanceof Error ? err.message : String(err);
  return { action: "next-model", reason: `unknown: ${message}` };
}

/**
 * Build the ordered fallback chain for a given starting model.
 *
 * The chain starts with the requested model (if known), then walks
 * through the rest of its tier, then downgrades to the next tier.
 *
 * Example:
 *   buildFallbackChain("mimo/mimo-v2.5-pro")
 *     → [mimo-v2.5-pro, deepseek-v4-pro, kimi-k2.6, glm-5.2,   // premium
 *        deepseek-v4-flash, mimo-v2.5,                          // limited
 *        minimax-m2.7]                                          // legacy
 *
 * Unknown models are placed first (so the caller gets a chance to try
 * them), then the full premium tier, then limited, then legacy.
 */
export function buildFallbackChain(
  requestedModelId: string,
): ReadonlyArray<FallbackCandidate> {
  const requested = getModelDescriptor(requestedModelId);
  const chain: FallbackCandidate[] = [];

  // 1. Requested model first (if known).
  if (requested) {
    chain.push({ tier: requested.tier, model: requested });
  }

  // 2. Rest of the requested model's tier (skipping the requested one).
  const tierModels =
    requested?.tier === "premium"
      ? getPremiumTierModels()
      : requested?.tier === "limited"
        ? getLimitedTierModels()
        : requested?.tier === "legacy"
          ? [LEGACY_MODEL]
          : [];

  for (const m of tierModels) {
    if (m.id !== requestedModelId) {
      chain.push({ tier: m.tier, model: m });
    }
  }

  // 3. Downgrade to lower tiers.
  if (requested?.tier === "premium") {
    for (const m of getLimitedTierModels()) {
      chain.push({ tier: "limited", model: m });
    }
    chain.push({ tier: "legacy", model: LEGACY_MODEL });
  } else if (requested?.tier === "limited") {
    chain.push({ tier: "legacy", model: LEGACY_MODEL });
  }

  // 4. If the model is unknown, fall back to the full premium chain.
  if (!requested) {
    for (const m of getPremiumTierModels()) {
      chain.push({ tier: "premium", model: m });
    }
    for (const m of getLimitedTierModels()) {
      chain.push({ tier: "limited", model: m });
    }
    chain.push({ tier: "legacy", model: LEGACY_MODEL });
  }

  return chain;
}

/**
 * The single legacy-tier model. Kept as a constant so the chain
 * builder doesn't depend on the model registry's filter order.
 */
const LEGACY_MODEL: FreebuffModelDescriptor = {
  id: "minimax/minimax-m2.7",
  name: "MiniMax M2.7 (WK / LITE)",
  agent: "base2-free",
  tier: "legacy",
  contextLength: 200_000,
  maxOutputTokens: 8_192,
  supportsVision: true,
};

/**
 * Pick the next candidate in the chain given the current attempt and
 * the error that caused the failure. Returns `null` when the chain is
 * exhausted.
 */
export function nextCandidate(
  chain: ReadonlyArray<FallbackCandidate>,
  currentIndex: number,
  err: unknown,
): { candidate: FallbackCandidate; index: number } | null {
  const decision = classifyError(err);

  switch (decision.action) {
    case "abort":
      return null;
    case "retry-same":
      if (currentIndex < chain.length) {
        return { candidate: chain[currentIndex]!, index: currentIndex };
      }
      return null;
    case "next-model":
    case "downgrade-tier": {
      // Walk forward until we find a candidate in a different tier
      // (for downgrade) or just the next one (for next-model).
      const startFrom = currentIndex + 1;
      for (let i = startFrom; i < chain.length; i++) {
        const candidate = chain[i]!;
        if (
          decision.action === "downgrade-tier" &&
          candidate.tier === chain[currentIndex]?.tier
        ) {
          continue;
        }
        return { candidate, index: i };
      }
      return null;
    }
    default:
      return null;
  }
}

// Re-export the model descriptor type so consumers don't need to
// import it from two places.
export type { FreebuffModelDescriptor };

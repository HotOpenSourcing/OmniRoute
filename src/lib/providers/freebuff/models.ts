/**
 * Freebuff (Codebuff) model catalog.
 *
 * Lists the models exposed by the `freebuff.exe` binary via the
 * `provider.listModels()` API. The catalog is a static snapshot — when
 * Codebuff ships new models, this file must be updated.
 *
 * CONTEXT WINDOW VALUES — NOTE
 * ----------------------------
 * - `mimo/mimo-v2.5` and `mimo/mimo-v2.5-pro`: 128k — confirmed from the
 *   freebuff binary per Chunk 6 spec.
 * - `z-ai/glm-5.2`: 1M — confirmed from the binary per Chunk 6 spec.
 * - All other values are marked `source: "external-default"` per the
 *   Chunk 6 Open Question resolution. They come from the upstream
 *   providers' public documentation (Moonshot, DeepSeek, Anthropic
 *   Bedrock docs).
 *
 * ACCESS TIER MODEL
 * -----------------
 * - `premium: false` models are always exposed (default `limitedTierAccess: true`).
 * - `premium: true` models are hidden in `limited` tier by default.
 * - `requiresReferral: true` models (e.g. glm-5.2) are always hidden in
 *   `limited` tier regardless of other flags.
 * - `limitedTierAccess: true` on a premium model is an explicit override
 *   — currently used for `moonshotai/kimi-k2.6` which Codebuff exposes to
 *   limited-tier users despite the premium flag.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schemas (runtime validation).
// ---------------------------------------------------------------------------

export const freebuffAccessTierSchema = z.enum(["full", "limited"]);
export type FreebuffAccessTier = z.infer<typeof freebuffAccessTierSchema>;

export const freebuffModalitySchema = z.enum(["text", "image", "audio"]);
export type FreebuffModality = z.infer<typeof freebuffModalitySchema>;

export const freebuffModelSourceSchema = z.enum([
  "extracted",
  "external-default",
]);
export type FreebuffModelSource = z.infer<typeof freebuffModelSourceSchema>;

export const freebuffModelSchema = z.object({
  /** Model id as used in `/v1/chat/completions` and `/v1/messages`. */
  id: z.string().min(1),
  /** Human-readable label for the dashboard. */
  displayName: z.string().min(1),
  /** Upstream model family (e.g. "v2.5", "k2.6"). */
  family: z.string().min(1),
  /** Logical tier — drives UI sorting and "LITE / PRO" badges. */
  tier: z.enum(["lite", "standard", "pro"]),
  /** True for paid models that require a full-tier account. */
  premium: z.boolean(),
  /** True for models that also require an active referral code. */
  requiresReferral: z.boolean().optional(),
  /**
   * Explicit override: when true, a premium model is also exposed to
   * `limited` access tiers. Defaults to `!premium && !requiresReferral`.
   */
  limitedTierAccess: z.boolean().optional(),
  /** Context window in tokens. */
  contextWindow: z.number().int().positive(),
  /** Maximum output tokens. */
  maxOutput: z.number().int().positive(),
  modalities: z.array(freebuffModalitySchema).min(1),
  /** Bedrock / OpenRouter / direct — when the model is reached indirectly. */
  upstreamProvider: z.string().optional(),
  /** Free-form tags ("free-default", "wk-alias", "referral-unlock"). */
  tags: z.array(z.string()).optional(),
  /** User-facing warnings rendered in the dashboard. */
  warnings: z.array(z.string()).optional(),
  /** Provenance marker — drives docs and audit logs. */
  source: freebuffModelSourceSchema,
});
export type FreebuffModel = z.infer<typeof freebuffModelSchema>;

// ---------------------------------------------------------------------------
// Catalog.
// ---------------------------------------------------------------------------

export const FREEBUFF_MODELS: readonly FreebuffModel[] = Object.freeze([
  Object.freeze({
    id: "mimo/mimo-v2.5",
    displayName: "MiMo v2.5",
    family: "v2.5",
    tier: "standard",
    premium: false,
    contextWindow: 128_000,
    maxOutput: 8_192,
    modalities: ["text", "image"],
    tags: ["free-default"],
    source: "extracted" as const,
  }),
  Object.freeze({
    id: "mimo/mimo-v2.5-pro",
    displayName: "MiMo v2.5 Pro",
    family: "v2.5",
    tier: "pro",
    premium: true,
    contextWindow: 128_000,
    maxOutput: 8_192,
    modalities: ["text", "image"],
    source: "extracted" as const,
  }),
  Object.freeze({
    id: "minimax/minimax-m3",
    displayName: "MiniMax M3 (Bedrock)",
    family: "m3",
    tier: "pro",
    premium: true,
    contextWindow: 200_000,
    maxOutput: 16_384,
    modalities: ["text", "image"],
    upstreamProvider: "bedrock",
    source: "extracted" as const,
  }),
  Object.freeze({
    id: "moonshotai/kimi-k2.6",
    displayName: "Kimi K2.6",
    family: "k2.6",
    tier: "standard",
    premium: true,
    // Premium, but Codebuff exposes it to limited-tier users — explicit override.
    limitedTierAccess: true,
    contextWindow: 256_000,
    maxOutput: 8_192,
    modalities: ["text", "image"],
    source: "external-default" as const,
  }),
  Object.freeze({
    id: "deepseek/deepseek-v4-flash",
    displayName: "DeepSeek v4 Flash",
    family: "v4",
    tier: "lite",
    premium: false,
    contextWindow: 128_000,
    maxOutput: 8_192,
    modalities: ["text"],
    source: "external-default" as const,
  }),
  Object.freeze({
    id: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek v4 Pro",
    family: "v4",
    tier: "pro",
    premium: true,
    contextWindow: 128_000,
    maxOutput: 8_192,
    modalities: ["text"],
    warnings: ["Collects data for training"],
    source: "external-default" as const,
  }),
  Object.freeze({
    id: "z-ai/glm-5.2",
    displayName: "GLM 5.2",
    family: "5.2",
    tier: "pro",
    premium: true,
    requiresReferral: true,
    contextWindow: 1_000_000,
    maxOutput: 8_192,
    modalities: ["text", "image"],
    tags: ["referral-unlock"],
    source: "extracted" as const,
  }),
  Object.freeze({
    id: "minimax/minimax-m2.7",
    displayName: "MiniMax M2.7 (WK / LITE)",
    family: "m2.7",
    tier: "lite",
    premium: false,
    contextWindow: 200_000,
    maxOutput: 8_192,
    modalities: ["text", "image"],
    tags: ["wk-alias", "lite-mode"],
    source: "external-default" as const,
  }),
]);

// ---------------------------------------------------------------------------
// Lookup helpers.
// ---------------------------------------------------------------------------

const MODELS_BY_ID = new Map<string, FreebuffModel>(
  FREEBUFF_MODELS.map((m) => [m.id, m]),
);

export function getFreebuffModel(id: string): FreebuffModel | undefined {
  return MODELS_BY_ID.get(id);
}

export function hasFreebuffModel(id: string): boolean {
  return MODELS_BY_ID.has(id);
}

export function listFreebuffModels(): readonly FreebuffModel[] {
  return FREEBUFF_MODELS;
}

// ---------------------------------------------------------------------------
// Freebuff root-agent mapping (rapport §5.2).
// ---------------------------------------------------------------------------

/**
 * Model id → Freebuff root agent id. Used by the chat integration to stamp
 * `codebuff.codebuff_metadata.cost_mode` (via `AGENT_MODE_TO_COST_MODE.LITE
 * = "free"`) and to enforce the `FREE_MODE_AGENT_MODELS` allowlist server-side.
 *
 * Models missing from this map fall back to `base2-free` (generic).
 */
export const FREEBUFF_ROOT_AGENT_ID_BY_MODEL: Readonly<Record<string, string>> =
  Object.freeze({
    "mimo/mimo-v2.5": "base2-free-mimo",
    "mimo/mimo-v2.5-pro": "base2-free-mimo-pro",
    "minimax/minimax-m3": "base2-free-minimax-m3",
    "minimax/minimax-m2.7": "base2-free",
    "moonshotai/kimi-k2.6": "base2-free-kimi",
    "deepseek/deepseek-v4-pro": "base2-free-deepseek",
    "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
    "z-ai/glm-5.2": "base2-free-glm",
  });

/** Resolve the root agent id for a given Freebuff model id. */
export function getFreebuffRootAgentIdForModel(model: string): string {
  return FREEBUFF_ROOT_AGENT_ID_BY_MODEL[model] ?? "base2-free";
}

/**
 * Freebuff (Codebuff Free Tier) — model → upstream `agentId` mapping.
 *
 * The Codebuff upstream gates `agentId` on `codebuff_metadata.agent` and
 * picks the matching system prompt + tool allowlist server-side. Sending
 * the wrong `agentId` for a given public model id yields a generic
 * fallback prompt and no tool calls. Sending none at all yields a
 * 4xx (the upstream treats it as "model not available on the free tier").
 *
 * Source: `common/src/agents/free-buff/*.ts` in the upstream Codebuff
 * repository — each agent file is named `base2-free-<slug>.ts` and exports
 * the matching `id`. Mapped here against OmniRoute's public model ids.
 *
 * ⚠ Keep this table in sync with the upstream agent catalogue. If a new
 *   model is added on OmniRoute's side, the agent must be discovered via
 *   a live `POST /api/v1/agent-runs {action:"START", agentId: <guess>}`
 *   probe (status 200 = mapped; 4xx = unknown).
 *
 * @module lib/providers/freebuff/agentMapping
 */

import { randomUUID } from "node:crypto";

/**
 * Static mapping table. Seeded from the upstream `FREE_MODE_AGENT_MODELS`
 * registry observed during Phase 4 dynamic capture
 * (`~/.config/manicode/freebuff-model-tests/phase4-deliverables/`).
 */
const AGENT_MAP: Readonly<Record<string, string>> = Object.freeze({
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base2-free-deepseek-v4-pro",
  "mimo/mimo-v2.5": "base2-free-mimo-v2.5",
  "mimo/mimo-v2.5-pro": "base2-free-mimo-v2.5-pro",
  "minimax/minimax-m3": "base2-free-minimax-m3",
  "moonshotai/kimi-k2.6": "base2-free-kimi-k2.6",
  "z-ai/glm-5.2": "base2-free-glm-5.2",
});

/**
 * Returns the upstream `agentId` for the given OmniRoute model id,
 * or `null` if no free-tier agent is mapped for that model.
 *
 * The caller (`chatIntegration`) is expected to surface a 400 to the
 * client when this returns `null`, since routing to the free tier
 * requires a known agent.
 */
export function getFreebuffAgentId(modelId: string): string | null {
  return AGENT_MAP[modelId] ?? null;
}

/**
 * Lists every model id that currently has a free-tier mapping.
 * Useful for catalog visibility (the dashboard can hide unmapped models
 * in `limited` tier).
 */
export function listFreebuffMappedModels(): readonly string[] {
  return Object.keys(AGENT_MAP);
}

/**
 * Generates a short, url-safe random id suitable for `userInputId`
 * (kept here for collocation with the agent-mapping logic).
 */
export function generateFreebuffRequestId(): string {
  // 36-char UUIDv4 is the wire shape observed in `validation-scripts/`.
  return randomUUID();
}

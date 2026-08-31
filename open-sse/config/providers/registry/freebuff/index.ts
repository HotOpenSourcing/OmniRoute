import type { RegistryEntry } from "../../shared.ts";

/**
 * Freebuff (Codebuff Free Tier) — opt-in OAuth provider that wraps the
 * `freebuff.exe` binary. Models come from `FREEBUFF_MODELS`
 * (`src/lib/providers/freebuff/models.ts`); the chat executor is
 * `FreebuffExecutor` (`open-sse/executors/freebuff.ts`), which delegates
 * to `routeFreebuffChat` (`src/lib/providers/freebuff/chatIntegration.ts`)
 * to inject the proprietary Codebuff wire envelope (top-level `runId`,
 * `provider`, `codebuff_metadata`, plus seat acquisition and agent-run
 * registration).
 *
 * Models with `requiresReferral` or `premium` flags are listed here for
 * the `full` tier — tier filtering happens at the per-connection
 * `/api/providers/[id]/models` endpoint using
 * `filterByAccessTier(FREEBUFF_MODELS, connection.accessTier)`.
 */
export const freebuffProvider: RegistryEntry = {
  id: "freebuff",
  alias: "fb",
  format: "openai",
  executor: "freebuff",
  baseUrl: "https://www.codebuff.com",
  chatPath: "/api/v1/chat/completions",
  urlSuffix: "/api/v1/chat/completions",
  authType: "oauth",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  defaultContextLength: 128000,
  models: [
    {
      id: "mimo/mimo-v2.5",
      name: "MiMo v2.5",
      contextLength: 128000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: "mimo/mimo-v2.5-pro",
      name: "MiMo v2.5 Pro",
      contextLength: 128000,
      maxOutputTokens: 8192,
      supportsVision: true,
    },
    {
      id: "minimax/minimax-m3",
      name: "MiniMax M3 (Bedrock)",
      contextLength: 200000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: "moonshotai/kimi-k2.6",
      name: "Kimi K2.6",
      contextLength: 256000,
      maxOutputTokens: 8192,
      supportsVision: true,
    },
    {
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek v4 Flash",
      contextLength: 128000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek v4 Pro",
      contextLength: 128000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "openai/gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      contextLength: 131072,
      supportsReasoning: true,
    },
    {
      id: "z-ai/glm-5.2",
      name: "GLM 5.2",
      contextLength: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: "minimax/minimax-m2.7",
      name: "MiniMax M2.7 (WK / LITE)",
      contextLength: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
    },
    {
      id: "crof/kimi-k3-eco",
      name: "Kimi K3 Eco",
      contextLength: 131072,
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: "anthropic/claude-fable-5",
      name: "Claude Fable 5",
      contextLength: 131072,
      supportsVision: true,
      supportsReasoning: true,
    },
    {
      id: "meta/muse-spark-1.2-contributor",
      name: "Meta Muse Spark 1.2 Contributor",
      contextLength: 131072,
      supportsReasoning: true,
    },
  ],
};

import type { RegistryEntry } from "../../shared.ts";

/**
 * Freebuff (Codebuff Free Tier) — opt-in OAuth provider that wraps the
 * `freebuff.exe` binary. Models come from `FREEBUFF_MODELS`
 * (`src/lib/providers/freebuff/models.ts`); the chat executor is
 * custom-handled in `src/lib/providers/freebuff/chat.ts`, so this
 * registry entry uses the default executor.
 *
 * Models with `requiresReferral` or `premium` flags are listed here for
 * the `full` tier — tier filtering happens at the per-connection
 * `/api/providers/[id]/models` endpoint using
 * `filterByAccessTier(FREEBUFF_MODELS, connection.accessTier)`.
 */
export const freebuffProvider: RegistryEntry = {
  id: "freebuff",
  format: "openai",
  executor: "default",
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
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek v4 Pro",
      contextLength: 128000,
      maxOutputTokens: 8192,
    },
    {
      id: "z-ai/glm-5.2",
      name: "GLM 5.2",
      contextLength: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
    },
    {
      id: "minimax/minimax-m2.7",
      name: "MiniMax M2.7 (WK / LITE)",
      contextLength: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
    },
  ],
};

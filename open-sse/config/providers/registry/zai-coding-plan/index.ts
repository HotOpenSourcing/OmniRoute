import type { RegistryEntry } from "../../shared.ts";
import { getAnthropicCompatHeaders } from "../../shared.ts";

/**
 * Z.AI Coding Plan Provider — Manuel Token Import
 *
 * ⚠️ Le flow OAuth n'est pas réplicable en dehors du desktop ZCode.
 * L'utilisateur doit importer manuellement son JWT depuis ZCode.
 *
 * Procédure d'extraction du JWT :
 *   1. Ouvrir ZCode (connecté)
 *   2. Aller dans %APPDATA%/ZCode/v2/ (ou ~/.zcode/v2/)
 *   3. Ouvrir config.json
 *   4. Copier la valeur de builtin:zai-start-plan.options.apiKey
 *   5. Coller cette valeur dans OmniRoute comme token
 *
 * Endpoint proxy : https://zcode.z.ai/api/v1/zcode-plan/anthropic
 * Auth : Bearer JWT
 * Limitation connue : le proxy peut retourner un 403 captcha Aliyun
 *   depuis certaines IP. Si c'est le cas, réessayer depuis le réseau
 *   du desktop ZCode, ou extraire un nouveau token frais.
 *
 * Modèles confirmés via GET https://api.z.ai/api/coding/paas/v4
 */
export const zaiCodingPlanProvider: RegistryEntry = {
  id: "zai-coding-plan",
  alias: "zcp",
  format: "claude",
  executor: "default",
  baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
  authType: "bearer",
  authHeader: "authorization",
  headers: getAnthropicCompatHeaders(),
  // Models confirmed from GET https://api.z.ai/api/coding/paas/v4
  models: [
    {
      id: "glm-5.2",
      name: "GLM 5.2",
      contextLength: 1_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "glm-5.1",
      name: "GLM 5.1",
      contextLength: 1_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "glm-4.7",
      name: "GLM 4.7",
      contextLength: 128_000,
      maxOutputTokens: 4096,
    },
    {
      id: "glm-5-turbo",
      name: "GLM 5 Turbo",
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      supportsReasoning: true,
    },
    {
      id: "glm-4.5v",
      name: "GLM 4.5V",
      contextLength: 128_000,
      maxOutputTokens: 4096,
      supportsVision: true,
    },
    {
      id: "glm-5.2-long",
      name: "GLM 5.2 Long",
      contextLength: 2_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "glm-5.2-high",
      name: "GLM 5.2 High",
      contextLength: 1_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
    {
      id: "glm-5.2-pro",
      name: "GLM 5.2 Pro",
      contextLength: 1_000_000,
      maxOutputTokens: 8192,
      supportsReasoning: true,
    },
  ],
};

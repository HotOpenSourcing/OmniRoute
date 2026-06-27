import type { RegistryEntry } from "../../shared.ts";
import { GLM_SHARED_MODELS } from "../../shared.ts";

export const zaiDirectProvider: RegistryEntry = {
  id: "zai-direct",
  alias: "zai",
  format: "claude",
  executor: "glm",
  baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
  authType: "apikey",
  authHeader: "bearer",
  defaultContextLength: 200000,
  timeoutMs: 3_000_000,
  requestDefaults: {
    maxTokens: 16_384,
  },
  models: [...GLM_SHARED_MODELS],
};

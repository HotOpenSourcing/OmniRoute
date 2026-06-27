import type { RegistryEntry } from "../../shared.ts";
import {
  mapStainlessOs,
  mapStainlessArch,
} from "../../shared.ts";

/**
 * Kimchi AI (Cast AI "AI Enabler") provider.
 *
 * Source: reverse-engineered from the Kimchi CLI binary (v0.1.50) which uses
 * the OpenAI Node SDK (Stainless-generated) at version 6.26.0 against the
 * upstream Cast AI router at https://llm.kimchi.dev.
 *
 * Critical: the upstream router whitelists requests with `User-Agent: kimchi/...`
 * AND the full Stainless SDK header set (`x-stainless-*`). Requests without
 * the official Kimchi User-Agent get HTTP 402 "provider has exhausted credits"
 * even when credits are available.
 *
 * Models exposed:
 *   - minimax-m3            (1M ctx, vision, reasoning)
 *   - kimi-k2.7             (262K ctx, vision, reasoning)
 *   - glm-5.2-fp8           (1M ctx, reasoning)
 *   - deepseek-v4-flash     (1M ctx, reasoning)
 *   - nemotron-3-ultra-fp4  (1M ctx, reasoning)
 *
 * Provider upstream: ai-enabler (Cast AI internal router).
 */
const KIMCHI_USER_AGENT = "kimchi/0.1.50";
const KIMCHI_STAINLESS_PACKAGE_VERSION = "6.26.0";
const KIMCHI_STAINLESS_RUNTIME_VERSION = "v24.3.0";

export function getKimchiHeaders(): Record<string, string> {
  return {
    "user-agent": KIMCHI_USER_AGENT,
    "x-stainless-arch": mapStainlessArch(),
    "x-stainless-lang": "js",
    "x-stainless-os": mapStainlessOs(),
    "x-stainless-package-version": KIMCHI_STAINLESS_PACKAGE_VERSION,
    "x-stainless-retry-count": "0",
    "x-stainless-runtime": "node",
    "x-stainless-runtime-version": KIMCHI_STAINLESS_RUNTIME_VERSION,
    "x-stainless-timeout": "300",
  };
}

export const kimchiProvider: RegistryEntry = {
  id: "kimchi",
  alias: "kimchi",
  format: "openai",
  executor: "default",
  baseUrl: "https://llm.kimchi.dev/openai/v1/chat/completions",
  authType: "apikey",
  authHeader: "bearer",
  defaultContextLength: 1048576, // 1M context window (Minimax-M3 ceiling)
  headers: getKimchiHeaders(),
  models: [
    {
      id: "minimax-m3",
      name: "MiniMax M3 (1M ctx, vision, reasoning)",
      contextLength: 1048576,
    },
    {
      id: "kimi-k2.7",
      name: "Kimi K2.7 (262K ctx, vision, reasoning)",
      contextLength: 262144,
    },
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8 (1M ctx, reasoning)",
      contextLength: 1048576,
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash (1M ctx, reasoning)",
      contextLength: 1048576,
    },
    {
      id: "nemotron-3-ultra-fp4",
      name: "Nemotron 3 Ultra FP4 (1M ctx, reasoning)",
      contextLength: 1048576,
    },
  ],
  passthroughModels: true,
};

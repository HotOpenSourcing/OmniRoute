import type { RegistryEntry } from "../../shared.ts";
import { mapStainlessOs, mapStainlessArch } from "../../shared.ts";

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
 * Models exposed (live-probed 2026-06-29, see .kimchi/docs/KIMCHI_MODEL_MAP.md):
 *   - minimax-m3            (1M ctx / 1M out, vision, tools, reasoning)
 *   - kimi-k2.7             (262K ctx / 262K out, vision, tools, reasoning)
 *   - glm-5.2-fp8           (1M ctx / 1M out, tools, reasoning)
 *   - deepseek-v4-flash     (1M ctx / 1M out, tools, reasoning) — most reliable
 *   - nemotron-3-ultra-fp4  (1M ctx / 1M out, tools, reasoning) — flaky
 *
 * Provider upstream: ai-enabler (Cast AI internal router).
 * Backend: SGLang. Valid reasoning_effort: none | low | medium | high | max.
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
    // Required by Cast AI router for streaming to return 200 (part of the
    // Stainless SDK session tracking that the router whitelists)
    "x-session-id": "omniroute-kimchi",
    "x-turn-index": "0",
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
  timeoutMs: 60000, // upstream latencies observed up to ~28s; give headroom
  headers: getKimchiHeaders(),
  // The upstream router requires the full Stainless SDK header set; otherwise
  // it returns "provider has exhausted credits" even when credits are available.
  preserveStainlessHeaders: true,
  models: [
    {
      id: "minimax-m3",
      name: "MiniMax M3 (1M ctx, vision, tools, reasoning)",
      contextLength: 1048576,
      maxOutputTokens: 1048576,
      supportsVision: true,
      toolCalling: true,
      supportsReasoning: true,
      // Flaky: produces content only with reasoning_effort >= high in probes.
      interleavedField: "reasoning_content",
    },
    {
      id: "kimi-k2.7",
      name: "Kimi K2.7 (262K ctx, vision, tools, reasoning)",
      contextLength: 262144,
      maxOutputTokens: 262144,
      supportsVision: true,
      toolCalling: true,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
    {
      id: "glm-5.2-fp8",
      name: "GLM 5.2 FP8 (1M ctx, tools, reasoning)",
      contextLength: 1048576,
      maxOutputTokens: 1048576,
      toolCalling: true,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash (1M ctx, tools, reasoning)",
      contextLength: 1048576,
      maxOutputTokens: 1048576,
      toolCalling: true,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
    {
      id: "nemotron-3-ultra-fp4",
      name: "Nemotron 3 Ultra FP4 (1M ctx, tools, reasoning)",
      contextLength: 1048576,
      maxOutputTokens: 1048576,
      toolCalling: true,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
  ],
  // SGLang rejects unknown slugs with HTTP 400; do not allow arbitrary model IDs.
  passthroughModels: false,
};

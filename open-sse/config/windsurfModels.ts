import type { RegistryModel } from "./providerRegistry.ts";

export type WindsurfModelCapability = RegistryModel & {
  upstreamId: number;
  autoToolChoice?: boolean;
  stopSequences?: readonly string[];
  maxOutputTokens?: number;
  topKLimit?: number;
};

export const WINDSURF_DEFAULT_MAX_OUTPUT_TOKENS = 8192;
export const WINDSURF_DEFAULT_TOP_K_LIMIT = 200;
export const WINDSURF_MODEL_PREFIX = "windsurf/";

const DEEPSEEK_STOP_SEQUENCES = Object.freeze([
  "<codebase_search>",
  "<write_to_file>",
  "<open_link>",
]);

export const WINDSURF_MODELS: readonly WindsurfModelCapability[] = Object.freeze([
  {
    id: "gpt4o",
    name: "GPT-4o",
    upstreamId: 109,
    autoToolChoice: true,
  },
  {
    id: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet",
    upstreamId: 166,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    upstreamId: 184,
  },
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    upstreamId: 205,
    stopSequences: DEEPSEEK_STOP_SEQUENCES,
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    upstreamId: 206,
    supportsReasoning: true,
    stopSequences: DEEPSEEK_STOP_SEQUENCES,
  },
  {
    id: "gpt4-o3-mini",
    name: "GPT-4 o3 Mini",
    upstreamId: 207,
    autoToolChoice: true,
  },
  {
    id: "claude-3-7-sonnet",
    name: "Claude 3.7 Sonnet",
    upstreamId: 226,
  },
  {
    id: "claude-3-7-sonnet-think",
    name: "Claude 3.7 Sonnet Think",
    upstreamId: 227,
    supportsReasoning: true,
  },
]);

export const WINDSURF_DISPLAY_CATALOG: readonly Pick<WindsurfModelCapability, "id" | "name">[] = Object.freeze([
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
  },
  {
    id: "claude-opus-4.7",
    name: "Claude Opus 4.7",
  },
  {
    id: "swe-1.6",
    name: "SWE-1.6",
  },
  {
    id: "swe-1.6-fast",
    name: "SWE-1.6 Fast",
  },
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1",
  },
]);

export function getWindsurfModel(modelId: string): WindsurfModelCapability | null {
  return WINDSURF_MODELS.find((model) => model.id === modelId) || null;
}

export function getWindsurfUpstreamModelId(modelId: string): number | null {
  return getWindsurfModel(modelId)?.upstreamId ?? null;
}

export function isWindsurfModel(modelId: string | null | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith(WINDSURF_MODEL_PREFIX);
}

export function trimWindsurfModelPrefix(modelId: string | null | undefined): string | null {
  if (!isWindsurfModel(modelId)) {
    return null;
  }

  const qualifiedModelId = modelId as string;
  const trimmed = qualifiedModelId.slice(WINDSURF_MODEL_PREFIX.length).trim();
  return trimmed || null;
}

export function getQualifiedWindsurfModel(modelId: string): string {
  return modelId.startsWith(WINDSURF_MODEL_PREFIX) ? modelId : `${WINDSURF_MODEL_PREFIX}${modelId}`;
}

export function getWindsurfModelFromQualifiedId(
  modelId: string | null | undefined
): WindsurfModelCapability | null {
  const trimmed = trimWindsurfModelPrefix(modelId);
  return trimmed ? getWindsurfModel(trimmed) : null;
}

export function getWindsurfStopSequences(modelId: string): readonly string[] {
  return getWindsurfModel(modelId)?.stopSequences || [];
}

export function windsurfModelSupportsReasoning(modelId: string): boolean {
  return Boolean(getWindsurfModel(modelId)?.supportsReasoning);
}

export function windsurfModelUsesAutoToolChoice(modelId: string): boolean {
  return Boolean(getWindsurfModel(modelId)?.autoToolChoice);
}

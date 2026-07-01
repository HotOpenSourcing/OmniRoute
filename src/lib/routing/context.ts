import { getCanonicalModelMetadata } from "@/lib/modelMetadataRegistry";
import type { RoutingContext } from "./types";

function resolvePremiumSignal(provider: string, model: string) {
  const metadata = getCanonicalModelMetadata({ provider, model });

  return Boolean(
    metadata?.capabilities.reasoning ||
      metadata?.capabilities.supportsThinking ||
      metadata?.metadata.family?.match(/opus|sonnet|gpt-5|gemini-2\.5/i)
  );
}

export function buildRoutingContext({
  provider,
  model,
  body,
}: {
  provider: string;
  model: string;
  body: Record<string, unknown> | null | undefined;
}): RoutingContext {
  const metadata = getCanonicalModelMetadata({ provider, model });
  const routing = metadata?.routing || {
    executionMode: "prefer_cloud" as const,
    requiresLocal: false,
    supportsLocal: false,
    supportsCloud: true,
  };

  return {
    modelId: `${provider}/${model}`,
    provider,
    executionMode: routing.executionMode,
    requiresLocal: routing.requiresLocal,
    supportsLocal: routing.supportsLocal,
    supportsCloud: routing.supportsCloud,
    isPremium: resolvePremiumSignal(provider, model),
    toolCalling: Array.isArray(body?.tools) && body.tools.length > 0,
    runtime: {
      lsOk: routing.supportsLocal,
      cloudOk: routing.supportsCloud,
      source: "capability_defaults",
    },
  };
}

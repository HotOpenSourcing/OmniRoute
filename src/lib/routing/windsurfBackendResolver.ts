export type WindsurfRuntimeSnapshot = {
  lsOk: boolean;
  availableModels: string[];
  source: "capability_defaults" | "observed_health";
  modelDiscovery: {
    status: "present" | "enriched" | "missing" | "failed" | "pending";
    source: "session/new" | "session/load" | "session/resume" | "none";
    reason?: "auth_failure" | "registry_failure" | "not_provided" | "unknown";
  };
};

export type ResolveWindsurfBackendInput = {
  requestedProvider: string;
  requestedModel: string;
  body: Record<string, unknown> | null | undefined;
  runtime: WindsurfRuntimeSnapshot;
};

export type ResolvedWindsurfBackend = {
  requestedProvider: string;
  requestedModel: string;
  effectiveProvider: string;
  effectiveModel: string;
  reason: string;
};

export function resolveWindsurfBackend({
  requestedProvider,
  requestedModel,
  runtime,
}: ResolveWindsurfBackendInput): ResolvedWindsurfBackend {
  if (requestedProvider !== "windsurf") {
    return {
      requestedProvider,
      requestedModel,
      effectiveProvider: requestedProvider,
      effectiveModel: requestedModel,
      reason: "non-windsurf provider bypasses backend resolver",
    };
  }

  const localModelAvailable = runtime.lsOk && runtime.availableModels.includes(requestedModel);

  if (localModelAvailable) {
    return {
      requestedProvider,
      requestedModel,
      effectiveProvider: "windsurf-local",
      effectiveModel: requestedModel,
      reason: "healthy local Windsurf runtime advertises the requested model, so execution is stabilized to windsurf-local",
    };
  }

  return {
    requestedProvider,
    requestedModel,
    effectiveProvider: "windsurf",
    effectiveModel: requestedModel,
    reason: "cloud fallback because the local Windsurf runtime is unavailable or does not advertise the requested model",
  };
}

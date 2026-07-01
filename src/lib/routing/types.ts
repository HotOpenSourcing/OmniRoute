export type BackendKind = "local_ls" | "cloud_api" | "hybrid";

export type ExecutionTrace = {
  modelId: string;
  primaryBackend: BackendKind;
  fallbackBackend?: Exclude<BackendKind, "hybrid">;
  reason: string;
};

export type FallbackBackend = Exclude<BackendKind, "hybrid">;

export type RouteDecision = {
  provider: string;
  primary: BackendKind;
  fallback?: FallbackBackend;
  locked: true;
  reason: string;
  trace: ExecutionTrace;
};

export type RoutingResolution<Executor = unknown> = {
  decision: RouteDecision;
  executor: Executor;
};

export type PlannedExecutionAttempt<Executor = unknown> = {
  model: string;
  upstreamModel: string;
  decision: RouteDecision;
  executor: Executor;
};

export type ExecutionPlan<Executor = unknown> = {
  primaryModel: string;
  fallbackChain: string[];
  attempts: PlannedExecutionAttempt<Executor>[];
};

export type RoutingContext = {
  modelId: string;
  provider: string;
  executionMode: "local_only" | "cloud_only" | "prefer_local" | "prefer_cloud" | "hybrid";
  requiresLocal: boolean;
  supportsLocal: boolean;
  supportsCloud: boolean;
  isPremium: boolean;
  toolCalling: boolean;
  runtime: {
    lsOk: boolean;
    cloudOk: boolean;
    source: "capability_defaults" | "observed_health";
  };
};

export type ResolveExecutionPlanInput = {
  routeContext: RoutingContext;
  request: {
    provider: string;
    model: string;
    body: Record<string, unknown> | null | undefined;
    requestedProvider?: string;
    requestedModel?: string;
  };
};

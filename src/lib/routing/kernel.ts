import type { RouteDecision, RoutingContext } from "./types";

function buildDecision(
  context: RoutingContext,
  primary: RouteDecision["primary"],
  reason: string,
  fallback?: RouteDecision["fallback"]
): RouteDecision {
  const trace = Object.freeze({
    modelId: context.modelId,
    primaryBackend: primary,
    fallbackBackend: fallback,
    reason,
  });

  return Object.freeze({
    provider: context.provider,
    primary,
    fallback,
    locked: true,
    reason,
    trace,
  });
}

export class RoutingKernel {
  route(context: RoutingContext): RouteDecision {
    if (context.requiresLocal) {
      if (context.runtime.lsOk) {
        return buildDecision(
          context,
          "local_ls",
          "requiresLocal model with healthy LS runtime",
          context.supportsCloud ? "cloud_api" : undefined
        );
      }

      if (!context.supportsCloud) {
        return buildDecision(
          context,
          "local_ls",
          "requiresLocal model remains local because cloud is unsupported",
          undefined
        );
      }

      return buildDecision(
        context,
        "cloud_api",
        "requiresLocal model fell back to cloud because LS is unavailable",
        undefined
      );
    }

    if (context.executionMode === "cloud_only") {
      return buildDecision(context, "cloud_api", "cloud_only model", undefined);
    }

    if (context.executionMode === "hybrid") {
      return buildDecision(context, "hybrid", "hybrid model requires split execution", "cloud_api");
    }

    if (context.toolCalling || context.isPremium) {
      return buildDecision(
        context,
        "cloud_api",
        context.toolCalling
          ? "tool calling requires cloud execution"
          : "premium model prefers cloud execution",
        context.supportsLocal && context.runtime.lsOk ? "local_ls" : undefined
      );
    }

    if (context.executionMode === "local_only") {
      return buildDecision(context, "local_ls", "local_only model", undefined);
    }

    if (context.executionMode === "prefer_local" && context.supportsLocal && context.runtime.lsOk) {
      return buildDecision(
        context,
        "local_ls",
        "prefer_local model with healthy LS runtime",
        context.supportsCloud ? "cloud_api" : undefined
      );
    }

    if (context.supportsCloud) {
      return buildDecision(
        context,
        "cloud_api",
        "default cloud-capable routing",
        context.supportsLocal && context.runtime.lsOk ? "local_ls" : undefined
      );
    }

    return buildDecision(context, "local_ls", "default local-capable routing", undefined);
  }
}

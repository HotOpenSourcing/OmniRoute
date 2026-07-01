import { bootstrapWindsurfSession, type BootstrapWindsurfSessionOptions } from "@/lib/acp/windsurfLocal";

import type { WindsurfRuntimeSnapshot } from "./windsurfBackendResolver";

type InspectInput = {
  requestedModel: string;
  credentials: {
    apiKey?: string;
  };
  cwd: string;
};

type InspectorResult = WindsurfRuntimeSnapshot & {
  localModelAvailable: boolean;
  reason: string;
  diagnosticsSummary?: {
    modelDiscoveryStatus: string;
    modelDiscoverySource: string;
    rpcRequestCount?: number;
    rpcResponseCount?: number;
    notificationCount?: number;
    stderrCount?: number;
  };
};

type InspectorDependencies = {
  ttlMs?: number;
  now?: () => number;
  bootstrap?: (options: BootstrapWindsurfSessionOptions) => Promise<Awaited<ReturnType<typeof bootstrapWindsurfSession>>>;
};

type CacheEntry = {
  expiresAt: number;
  value: InspectorResult;
};

const DEFAULT_TTL_MS = 30_000;

export function createWindsurfRuntimeInspector({
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  bootstrap = bootstrapWindsurfSession,
}: InspectorDependencies = {}) {
  let cache: CacheEntry | null = null;

  return {
    async inspect({ requestedModel, credentials, cwd }: InspectInput): Promise<InspectorResult> {
      const currentTime = now();
      if (cache && cache.expiresAt > currentTime) {
        return {
          ...cache.value,
          localModelAvailable: cache.value.availableModels.includes(requestedModel),
        };
      }

      try {
        const result = await bootstrap({
          apiKey: credentials.apiKey || "",
          cwd,
        });
        const availableModels = result.models?.availableModels.map((entry) => entry.id) || [];
        const snapshot: InspectorResult = {
          lsOk: availableModels.length > 0,
          localModelAvailable: availableModels.includes(requestedModel),
          availableModels,
          source: "observed_health",
          modelDiscovery: result.modelDiscovery,
          diagnosticsSummary: {
            modelDiscoveryStatus: result.modelDiscovery.status,
            modelDiscoverySource: result.modelDiscovery.source,
            rpcRequestCount: result.diagnostics.rpc.requests.length,
            rpcResponseCount: result.diagnostics.rpc.responses.length,
            notificationCount: result.diagnostics.notifications.length,
            stderrCount: result.diagnostics.stderr.length,
          },
          reason: availableModels.length > 0 ? "local Windsurf runtime is available" : "cloud fallback because no local Windsurf models were discovered",
        };
        cache = {
          expiresAt: currentTime + ttlMs,
          value: snapshot,
        };
        return snapshot;
      } catch {
        const snapshot: InspectorResult = {
          lsOk: false,
          localModelAvailable: false,
          availableModels: [],
          source: "observed_health",
          modelDiscovery: {
            status: "failed",
            source: "none",
            reason: "unknown",
          },
          diagnosticsSummary: {
            modelDiscoveryStatus: "failed",
            modelDiscoverySource: "none",
          },
          reason: "cloud fallback because local Windsurf runtime inspection failed",
        };
        cache = {
          expiresAt: currentTime + ttlMs,
          value: snapshot,
        };
        return snapshot;
      }
    },
  };
}

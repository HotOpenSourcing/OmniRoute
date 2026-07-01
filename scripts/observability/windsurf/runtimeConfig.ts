import path from "node:path";

export const runtimeObservabilityConfig = {
  minLifetimeMs: 2000,
  artifactRoot: path.join(process.cwd(), "artifacts", "windsurf-observability"),
  activeLogNames: ["Windsurf.log", "renderer.log"],
  enableCdpCollector: true,
  enableLocalTrafficCollector: true,
  enableIpcPassiveCollector: true,
};

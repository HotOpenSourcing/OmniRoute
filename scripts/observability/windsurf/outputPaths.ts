import path from "node:path";

import { runtimeObservabilityConfig } from "./runtimeConfig";

export const outputPaths = {
  artifactRoot: runtimeObservabilityConfig.artifactRoot,
  rawEvents: path.join(runtimeObservabilityConfig.artifactRoot, "windsurf-passive-events.jsonl"),
  liveState: path.join(runtimeObservabilityConfig.artifactRoot, "windsurf-live-state.json"),
  sourceAdmission: path.join(
    runtimeObservabilityConfig.artifactRoot,
    "windsurf-source-admission.json"
  ),
  graphHistory: path.join(
    runtimeObservabilityConfig.artifactRoot,
    "windsurf-graph-history.json"
  ),
};

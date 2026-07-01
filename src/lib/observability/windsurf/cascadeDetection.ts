import type { CascadeState } from "./types";

export const detectCascadeExecution = (cascadeState: CascadeState) => {
  const detected =
    cascadeState.startCascade &&
    cascadeState.sendUserCascadeMessage &&
    typeof cascadeState.sessionId === "string" &&
    cascadeState.sessionId.length > 0 &&
    cascadeState.traceCount > 0 &&
    cascadeState.assistantResponse;

  return {
    detected,
    reason: detected
      ? "full cascade chain observed in the current valid graph"
      : "full chain not observed in the current valid graph",
  };
};

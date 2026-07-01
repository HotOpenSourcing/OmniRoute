import { detectCascadeExecution } from "./cascadeDetection";
import type {
  CascadeState,
  MaterializedCycleOutput,
  ObservabilityGraphState,
} from "./types";

export const materializeCycleOutput = (input: {
  graphState: ObservabilityGraphState;
  resetDetected: boolean;
  cascadeState: CascadeState;
}): MaterializedCycleOutput => {
  if (input.resetDetected || input.graphState === "unstable_observation") {
    return {
      graphState: input.graphState,
      cascadeState: input.cascadeState,
      decision: "RESET",
      reason: "primary graph is unstable or reset-dominant",
      confidence: "low",
    };
  }

  if (input.graphState === "no_activity") {
    return {
      graphState: input.graphState,
      cascadeState: input.cascadeState,
      decision: "WAITING",
      reason: "no admissible runtime activity observed yet",
      confidence: "low",
    };
  }

  const execution = detectCascadeExecution(input.cascadeState);
  if (execution.detected) {
    return {
      graphState: input.graphState,
      cascadeState: input.cascadeState,
      decision: "PARTIAL_SIGNAL",
      reason: "full cascade chain observed in the current valid graph",
      confidence: "high",
    };
  }

  if (input.graphState === "partial_signal") {
    return {
      graphState: input.graphState,
      cascadeState: input.cascadeState,
      decision: "PARTIAL_SIGNAL",
      reason: "stable graph with incomplete cascade chain",
      confidence: "medium",
    };
  }

  return {
    graphState: input.graphState,
    cascadeState: input.cascadeState,
    decision: "OBSERVING",
    reason: "stable graph with no admissible cascade fragments observed",
    confidence: "medium",
  };
};

import { reduceCascadeSignals } from "./correlation";
import { materializeCycleOutput } from "./materializeState";
import { normalizeObservedEvent } from "./normalization";
import { applyEventToGraphState, createInitialGraphState } from "./stability";
import type { CanonicalObservedEvent } from "./types";

export const createPassiveObservabilityEngine = () => {
  let graphState = createInitialGraphState("gc:uninitialized");
  const events: CanonicalObservedEvent[] = [];

  return {
    ingest(event: CanonicalObservedEvent) {
      const normalized = normalizeObservedEvent(event);
      events.push(normalized);

      if (graphState.graphId === "gc:uninitialized") {
        graphState = createInitialGraphState(normalized.graphCandidateId);
      }

      graphState = applyEventToGraphState(graphState, normalized);
      const cascadeState = reduceCascadeSignals(
        events.filter((item) => item.graphCandidateId === graphState.graphId)
      );

      return materializeCycleOutput({
        graphState: graphState.graphState,
        resetDetected: graphState.resetDetected,
        cascadeState,
      });
    },
  };
};

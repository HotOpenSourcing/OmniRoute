import { isStrongResetEvent } from "./graphIdentity";
import type { CanonicalObservedEvent, ObservabilityGraphState } from "./types";

export type GraphRuntimeState = {
  graphId: string;
  graphState: ObservabilityGraphState;
  isStable: boolean;
  resetDetected: boolean;
  firstSeenMonotonicMs: number | null;
  lastSeenMonotonicMs: number | null;
  primaryLogPresent: boolean;
};

const MIN_LIFETIME_MS = 2000;

export const createInitialGraphState = (graphId: string): GraphRuntimeState => ({
  graphId,
  graphState: "no_activity",
  isStable: false,
  resetDetected: false,
  firstSeenMonotonicMs: null,
  lastSeenMonotonicMs: null,
  primaryLogPresent: false,
});

export const applyEventToGraphState = (
  state: GraphRuntimeState,
  event: CanonicalObservedEvent
): GraphRuntimeState => {
  const firstSeenMonotonicMs = state.firstSeenMonotonicMs ?? event.monotonicMs;
  const lastSeenMonotonicMs = event.monotonicMs;
  const primaryLogPresent = event.name === "PrimaryLogMissing" ? false : true;
  const uptimeMs = lastSeenMonotonicMs - firstSeenMonotonicMs;
  const resetDetected = state.resetDetected || isStrongResetEvent(event);

  if (resetDetected || !primaryLogPresent) {
    return {
      ...state,
      firstSeenMonotonicMs,
      lastSeenMonotonicMs,
      primaryLogPresent,
      resetDetected: true,
      isStable: false,
      graphState: "unstable_observation",
    };
  }

  if (uptimeMs < MIN_LIFETIME_MS) {
    return {
      ...state,
      firstSeenMonotonicMs,
      lastSeenMonotonicMs,
      primaryLogPresent,
      graphState: "unstable_observation",
    };
  }

  return {
    ...state,
    firstSeenMonotonicMs,
    lastSeenMonotonicMs,
    primaryLogPresent,
    isStable: true,
    graphState: "observing",
  };
};

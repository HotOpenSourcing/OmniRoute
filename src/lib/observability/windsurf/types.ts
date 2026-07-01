export type ObservabilityGraphState =
  | "no_activity"
  | "unstable_observation"
  | "observing"
  | "partial_signal";

export type ObservabilityDecision = "WAITING" | "OBSERVING" | "PARTIAL_SIGNAL" | "RESET";
export type ObservabilityConfidence = "low" | "medium" | "high";
export type ObservabilitySourceType =
  | "CDP"
  | "IPC"
  | "WS"
  | "HTTP"
  | "LOG"
  | "PROCESS"
  | "RUNTIME";
export type ObservabilityTrustLevel = "passive_proven" | "passive_probable" | "rejected";
export type ObservabilityPhase = "observed" | "derived";

export type CanonicalObservedEventMetadata = {
  sessionId: string | null;
  traceCount: number;
  csrfToken: string | null;
  port?: number | null;
  path?: string | null;
  statusCode?: number | null;
  frameId?: string | null;
  requestId?: string | null;
  webSocketId?: string | null;
};

export type CanonicalObservedEvent = {
  eventId: string;
  graphCandidateId: string;
  sourceType: ObservabilitySourceType;
  sourceName: string;
  trustLevel: ObservabilityTrustLevel;
  timestamp: string;
  monotonicMs: number;
  pid?: number;
  ppid?: number;
  direction?: "upstream" | "downstream" | "internal" | "unknown";
  name: string;
  phase: ObservabilityPhase;
  metadata: CanonicalObservedEventMetadata;
  rawRef?: {
    file: string;
    offset: number;
  };
};

export type CascadeState = {
  startCascade: boolean;
  sendUserCascadeMessage: boolean;
  sessionId: string | null;
  traceCount: number;
  assistantResponse: boolean;
};

export type MaterializedCycleOutput = {
  graphState: ObservabilityGraphState;
  cascadeState: CascadeState;
  decision: ObservabilityDecision;
  reason: string;
  confidence: ObservabilityConfidence;
};

export const createEmptyCascadeState = (): CascadeState => ({
  startCascade: false,
  sendUserCascadeMessage: false,
  sessionId: null,
  traceCount: 0,
  assistantResponse: false,
});

export const createEmptyCycleOutput = (): MaterializedCycleOutput => ({
  graphState: "no_activity",
  cascadeState: createEmptyCascadeState(),
  decision: "WAITING",
  reason: "no admissible runtime activity observed yet",
  confidence: "low",
});

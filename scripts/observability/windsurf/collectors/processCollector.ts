import type { CanonicalObservedEvent } from "@/lib/observability/windsurf";

export const buildProcessObservedEvent = (input: {
  pid: number;
  ppid: number;
  name: string;
  port: number | null;
  monotonicMs: number;
}): CanonicalObservedEvent => ({
  eventId: `process:${input.pid}:${input.monotonicMs}`,
  graphCandidateId: "gc:pending",
  sourceType: "PROCESS",
  sourceName: "windsurf-process",
  trustLevel: "passive_proven",
  timestamp: new Date(0).toISOString(),
  monotonicMs: input.monotonicMs,
  pid: input.pid,
  ppid: input.ppid,
  name: "ProcessObserved",
  phase: "observed",
  metadata: {
    sessionId: null,
    traceCount: 0,
    csrfToken: null,
    port: input.port,
    path: null,
    statusCode: null,
    frameId: null,
    requestId: null,
    webSocketId: null,
  },
});

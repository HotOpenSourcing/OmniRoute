import type { CanonicalObservedEvent } from "@/lib/observability/windsurf";

export const parseWindsurfLogLine = (
  line: string,
  filePath: string,
  monotonicMs: number
): CanonicalObservedEvent | null => {
  const pidMatch = line.match(/pid\s+(\d+)/i);
  const pid = pidMatch ? Number(pidMatch[1]) : undefined;

  let name = "RuntimeLogLineObserved";
  if (/Starting language server process/i.test(line)) name = "LanguageServerStarted";
  if (/SendUserCascadeMessage/i.test(line)) name = "SendUserCascadeMessage";
  if (/StartCascade/i.test(line)) name = "StartCascade";
  if (/Shutting down/i.test(line)) name = "GraphResetDetected";

  return {
    eventId: `${filePath}:${monotonicMs}`,
    graphCandidateId: "gc:pending",
    sourceType: "LOG",
    sourceName: "windsurf-log",
    trustLevel: "passive_proven",
    timestamp: new Date(0).toISOString(),
    monotonicMs,
    pid,
    name,
    phase: "observed",
    metadata: {
      sessionId: null,
      traceCount: 0,
      csrfToken: null,
      port: undefined,
      path: null,
      statusCode: null,
      frameId: null,
      requestId: null,
      webSocketId: null,
    },
    rawRef: { file: filePath, offset: monotonicMs },
  };
};

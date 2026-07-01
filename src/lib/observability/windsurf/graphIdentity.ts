import type { CanonicalObservedEvent } from "./types";

export const assignGraphCandidateId = (
  event: CanonicalObservedEvent,
  logRoot: string | null
): string => {
  const root = logRoot || "no-log-root";
  const pid = event.pid ?? 0;
  const port = event.metadata.port ?? 0;
  return `gc:${root}:${pid}:${port}`;
};

export const isStrongResetEvent = (event: CanonicalObservedEvent): boolean => {
  if (event.name === "PrimaryLogMissing") return true;
  if (event.name === "Runtime.executionContextDestroyed") return true;
  if (event.name === "GraphResetDetected") return true;
  return false;
};

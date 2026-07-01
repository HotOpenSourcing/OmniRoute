import type { CanonicalObservedEvent } from "./types";

export const normalizeObservedEvent = (
  event: CanonicalObservedEvent
): CanonicalObservedEvent => ({
  ...event,
  metadata: {
    sessionId: event.metadata.sessionId ?? null,
    traceCount: event.metadata.traceCount ?? 0,
    csrfToken: event.metadata.csrfToken ?? null,
    port: event.metadata.port ?? null,
    path: event.metadata.path ?? null,
    statusCode: event.metadata.statusCode ?? null,
    frameId: event.metadata.frameId ?? null,
    requestId: event.metadata.requestId ?? null,
    webSocketId: event.metadata.webSocketId ?? null,
  },
});

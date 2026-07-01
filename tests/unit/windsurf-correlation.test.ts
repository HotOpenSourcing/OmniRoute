import assert from "node:assert/strict";
import test from "node:test";

import { reduceCascadeSignals } from "@/lib/observability/windsurf/correlation";
import type { CanonicalObservedEvent } from "@/lib/observability/windsurf/types";

const makeEvent = (
  name: string,
  overrides: Partial<CanonicalObservedEvent> = {}
): CanonicalObservedEvent => ({
  eventId: `evt-${name}`,
  graphCandidateId: "gc:test",
  sourceType: "LOG",
  sourceName: "windsurf-log",
  trustLevel: "passive_proven",
  timestamp: "2026-05-02T16:33:08.168Z",
  monotonicMs: 10,
  name,
  phase: "observed",
  metadata: {
    sessionId: null,
    traceCount: 0,
    csrfToken: null,
    port: 49265,
    path: null,
    statusCode: null,
    frameId: null,
    requestId: null,
    webSocketId: null,
  },
  ...overrides,
});

test("correlation accumulates partial cascade fragments without inventing missing fields", () => {
  const signals = reduceCascadeSignals([
    makeEvent("SendUserCascadeMessage"),
    makeEvent("StartCascade"),
    makeEvent("TraceCountObserved", {
      metadata: {
        sessionId: null,
        traceCount: 2,
        csrfToken: null,
        port: 49265,
        path: null,
        statusCode: null,
        frameId: null,
        requestId: null,
        webSocketId: null,
      },
    }),
  ]);

  assert.equal(signals.sendUserCascadeMessage, true);
  assert.equal(signals.startCascade, true);
  assert.equal(signals.traceCount, 2);
  assert.equal(signals.sessionId, null);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createPassiveObservabilityEngine } from "@/lib/observability/windsurf";

test("engine accumulates events and emits a stable observing state after the window", () => {
  const engine = createPassiveObservabilityEngine();

  engine.ingest({
    eventId: "evt-1",
    graphCandidateId: "gc:test",
    sourceType: "LOG",
    sourceName: "windsurf-log",
    trustLevel: "passive_proven",
    timestamp: "2026-05-02T16:33:08.168Z",
    monotonicMs: 0,
    name: "LanguageServerStarted",
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
  });

  const output = engine.ingest({
    eventId: "evt-2",
    graphCandidateId: "gc:test",
    sourceType: "LOG",
    sourceName: "windsurf-log",
    trustLevel: "passive_proven",
    timestamp: "2026-05-02T16:33:10.800Z",
    monotonicMs: 2500,
    name: "LanguageServerHeartbeat",
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
  });

  assert.equal(output.graphState, "observing");
  assert.equal(output.decision, "OBSERVING");
});

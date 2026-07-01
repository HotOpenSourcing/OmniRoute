import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyCascadeState,
  createEmptyCycleOutput,
  type CanonicalObservedEvent,
} from "@/lib/observability/windsurf/types";

test("createEmptyCascadeState returns the required strict defaults", () => {
  assert.deepEqual(createEmptyCascadeState(), {
    startCascade: false,
    sendUserCascadeMessage: false,
    sessionId: null,
    traceCount: 0,
    assistantResponse: false,
  });
});

test("createEmptyCycleOutput maps to a waiting decision by default", () => {
  assert.deepEqual(createEmptyCycleOutput(), {
    graphState: "no_activity",
    cascadeState: {
      startCascade: false,
      sendUserCascadeMessage: false,
      sessionId: null,
      traceCount: 0,
      assistantResponse: false,
    },
    decision: "WAITING",
    reason: "no admissible runtime activity observed yet",
    confidence: "low",
  });
});

test("canonical event shape keeps nullable metadata fields explicit", () => {
  const event: CanonicalObservedEvent = {
    eventId: "evt-1",
    graphCandidateId: "gc-1",
    sourceType: "LOG",
    sourceName: "windsurf-log",
    trustLevel: "passive_proven",
    timestamp: "2026-05-02T16:33:08.168Z",
    monotonicMs: 1,
    name: "SendUserCascadeMessage",
    phase: "observed",
    metadata: {
      sessionId: null,
      traceCount: 0,
      csrfToken: null,
      port: 49265,
      path: "/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
      statusCode: 200,
      frameId: null,
      requestId: null,
      webSocketId: null,
    },
  };

  assert.equal(event.metadata.sessionId, null);
  assert.equal(event.metadata.traceCount, 0);
});

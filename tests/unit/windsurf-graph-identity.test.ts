import assert from "node:assert/strict";
import test from "node:test";

import {
  assignGraphCandidateId,
  isStrongResetEvent,
} from "@/lib/observability/windsurf/graphIdentity";
import type { CanonicalObservedEvent } from "@/lib/observability/windsurf/types";

const createEvent = (overrides: Partial<CanonicalObservedEvent>): CanonicalObservedEvent => ({
  eventId: "evt-1",
  graphCandidateId: "gc-unknown",
  sourceType: "LOG",
  sourceName: "windsurf-log",
  trustLevel: "passive_proven",
  timestamp: "2026-05-02T16:33:08.168Z",
  monotonicMs: 10,
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
  pid: 16772,
  ...overrides,
});

test("assignGraphCandidateId uses strong runtime identity fields", () => {
  const graphId = assignGraphCandidateId(
    createEvent({ sourceName: "windsurf-log", pid: 16772 }),
    "C:/Users/amine/AppData/Roaming/Windsurf/logs/20260502T163244"
  );

  assert.equal(graphId, "gc:C:/Users/amine/AppData/Roaming/Windsurf/logs/20260502T163244:16772:49265");
});

test("executionContextDestroyed is treated as a strong reset signal", () => {
  assert.equal(
    isStrongResetEvent(createEvent({ sourceType: "CDP", name: "Runtime.executionContextDestroyed" })),
    true
  );
});

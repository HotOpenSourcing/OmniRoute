import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunnerArtifacts,
  reduceEventsToLatestState,
} from "../../scripts/observability/windsurf/runPassiveObserver";

const observedEvents = [
  {
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
  },
  {
    eventId: "evt-2",
    graphCandidateId: "gc:test",
    sourceType: "LOG",
    sourceName: "windsurf-log",
    trustLevel: "passive_proven",
    timestamp: "2026-05-02T16:33:10.668Z",
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
  },
] as const;

test("runner reduces events into the latest materialized state", () => {
  const output = reduceEventsToLatestState([...observedEvents]);
  assert.equal(output.graphState, "observing");
  assert.equal(output.decision, "OBSERVING");
});

test("runner artifact helper returns the four required output paths", () => {
  const artifacts = createRunnerArtifacts();
  assert.ok(artifacts.rawEvents.endsWith("windsurf-passive-events.jsonl"));
  assert.ok(artifacts.liveState.endsWith("windsurf-live-state.json"));
  assert.ok(artifacts.sourceAdmission.endsWith("windsurf-source-admission.json"));
  assert.ok(artifacts.graphHistory.endsWith("windsurf-graph-history.json"));
});

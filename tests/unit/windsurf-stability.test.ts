import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEventToGraphState,
  createInitialGraphState,
} from "@/lib/observability/windsurf/stability";
import type { CanonicalObservedEvent } from "@/lib/observability/windsurf/types";

const createEvent = (
  monotonicMs: number,
  name: string,
  overrides: Partial<CanonicalObservedEvent> = {}
): CanonicalObservedEvent => ({
  eventId: `evt-${monotonicMs}`,
  graphCandidateId: "gc:test",
  sourceType: "LOG",
  sourceName: "windsurf-log",
  trustLevel: "passive_proven",
  timestamp: "2026-05-02T16:33:08.168Z",
  monotonicMs,
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

test("graph remains unstable until the minimum lifetime is reached", () => {
  let state = createInitialGraphState("gc:test");
  state = applyEventToGraphState(state, createEvent(0, "LanguageServerStarted"));
  state = applyEventToGraphState(state, createEvent(1500, "LanguageServerHeartbeat"));

  assert.equal(state.graphState, "unstable_observation");
  assert.equal(state.isStable, false);
});

test("graph becomes observing after 2000ms of continuous primary-log presence", () => {
  let state = createInitialGraphState("gc:test");
  state = applyEventToGraphState(state, createEvent(0, "LanguageServerStarted"));
  state = applyEventToGraphState(state, createEvent(2500, "LanguageServerHeartbeat"));

  assert.equal(state.graphState, "observing");
  assert.equal(state.isStable, true);
});

test("primary-log loss forces reset-dominant unstable observation", () => {
  let state = createInitialGraphState("gc:test");
  state = applyEventToGraphState(state, createEvent(0, "LanguageServerStarted"));
  state = applyEventToGraphState(state, createEvent(2500, "LanguageServerHeartbeat"));
  state = applyEventToGraphState(state, createEvent(2600, "PrimaryLogMissing"));

  assert.equal(state.graphState, "unstable_observation");
  assert.equal(state.resetDetected, true);
});

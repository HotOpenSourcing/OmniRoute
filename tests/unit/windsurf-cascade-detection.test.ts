import assert from "node:assert/strict";
import test from "node:test";

import { detectCascadeExecution } from "@/lib/observability/windsurf/cascadeDetection";

test("strict detection rejects incomplete cascade chains", () => {
  const result = detectCascadeExecution({
    startCascade: true,
    sendUserCascadeMessage: true,
    sessionId: null,
    traceCount: 2,
    assistantResponse: false,
  });

  assert.equal(result.detected, false);
  assert.match(result.reason, /full chain/i);
});

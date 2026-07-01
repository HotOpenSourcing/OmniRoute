import assert from "node:assert/strict";
import test from "node:test";

import { materializeCycleOutput } from "@/lib/observability/windsurf/materializeState";

test("materialized state maps stable partial evidence to PARTIAL_SIGNAL", () => {
  const output = materializeCycleOutput({
    graphState: "partial_signal",
    resetDetected: false,
    cascadeState: {
      startCascade: true,
      sendUserCascadeMessage: true,
      sessionId: null,
      traceCount: 0,
      assistantResponse: false,
    },
  });

  assert.deepEqual(output, {
    graphState: "partial_signal",
    cascadeState: {
      startCascade: true,
      sendUserCascadeMessage: true,
      sessionId: null,
      traceCount: 0,
      assistantResponse: false,
    },
    decision: "PARTIAL_SIGNAL",
    reason: "stable graph with incomplete cascade chain",
    confidence: "medium",
  });
});

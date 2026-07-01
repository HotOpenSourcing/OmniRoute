import assert from "node:assert/strict";
import test from "node:test";

import {
  canInfluenceInference,
  createCollectorAdmission,
} from "@/lib/observability/windsurf/sourceTrust";

test("passive probable collectors cannot drive inference alone", () => {
  const admission = createCollectorAdmission({
    collector: "cdpCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: false,
    activationRequiresNewConnection: true,
    mayChangeRuntimeState: false,
    passivityEvidence: "assumed",
  });

  assert.equal(admission.trustLevel, "passive_probable");
  assert.equal(canInfluenceInference(admission.trustLevel), false);
});

test("runtime-changing collectors are rejected", () => {
  const admission = createCollectorAdmission({
    collector: "rpcReplayCollector",
    mode: "read_only",
    activationRequiresRuntimeChange: true,
    activationRequiresNewConnection: true,
    mayChangeRuntimeState: true,
    passivityEvidence: "documented",
  });

  assert.equal(admission.trustLevel, "rejected");
});

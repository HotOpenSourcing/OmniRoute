import assert from "node:assert/strict";
import test from "node:test";

import { buildCollectorAdmissions } from "../../scripts/observability/windsurf/collectorAdmission";
import { createConditionalCollector } from "../../scripts/observability/windsurf/collectors/localTrafficCollector";

test("collector admission rejects runtime-changing collectors and allows logs/processes", () => {
  const admissions = buildCollectorAdmissions();

  assert.equal(admissions.logCollector.trustLevel, "passive_proven");
  assert.equal(admissions.processCollector.trustLevel, "passive_proven");
  assert.equal(admissions.cdpCollector.trustLevel, "passive_probable");
  assert.equal(admissions.localTrafficCollector.trustLevel, "passive_probable");
  assert.equal(admissions.ipcPassiveCollector.trustLevel, "passive_probable");
});

test("conditional collectors stay disabled until passivity is explicitly proven", async () => {
  const collector = createConditionalCollector("localTrafficCollector", "passive_probable");
  const events: unknown[] = [];

  for await (const event of collector.start()) {
    events.push(event);
  }

  assert.deepEqual(events, []);
});

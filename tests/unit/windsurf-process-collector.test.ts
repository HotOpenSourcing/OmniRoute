import assert from "node:assert/strict";
import test from "node:test";

import { buildProcessObservedEvent } from "../../scripts/observability/windsurf/collectors/processCollector";

test("process collector emits a process event with strong identity metadata", () => {
  const event = buildProcessObservedEvent({
    pid: 16772,
    ppid: 15372,
    name: "language_server_windows_x64",
    port: 49265,
    monotonicMs: 50,
  });

  assert.equal(event.sourceType, "PROCESS");
  assert.equal(event.metadata.port, 49265);
  assert.equal(event.pid, 16772);
});

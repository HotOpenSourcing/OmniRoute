import assert from "node:assert/strict";
import test from "node:test";

import { parseWindsurfLogLine } from "../../scripts/observability/windsurf/collectors/logCollector";

test("log collector extracts StartCascade-like names without inventing session data", () => {
  const event = parseWindsurfLogLine(
    "2026-05-02 16:33:08.161 [info] I0502 16:33:08.161476 16772 main.go:824] Starting language server process with pid 16772",
    "C:/Users/amine/AppData/Roaming/Windsurf/logs/20260502T163244/window1/exthost/codeium.windsurf/Windsurf.log",
    0
  );

  assert.equal(event?.name, "LanguageServerStarted");
  assert.equal(event?.pid, 16772);
  assert.equal(event?.metadata.sessionId, null);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  WINDSURF_DISPLAY_CATALOG,
  getQualifiedWindsurfModel,
  getWindsurfModelFromQualifiedId,
  getWindsurfStopSequences,
  isWindsurfModel,
  trimWindsurfModelPrefix,
  windsurfModelSupportsReasoning,
  windsurfModelUsesAutoToolChoice,
} from "../../open-sse/config/windsurfModels.ts";

test("Windsurf model helpers parse and qualify model names", () => {
  assert.equal(isWindsurfModel("windsurf/gpt4o"), true);
  assert.equal(isWindsurfModel("gpt4o"), false);
  assert.equal(trimWindsurfModelPrefix("windsurf/gpt4o"), "gpt4o");
  assert.equal(trimWindsurfModelPrefix("gpt4o"), null);
  assert.equal(getQualifiedWindsurfModel("gpt4o"), "windsurf/gpt4o");
  assert.equal(getQualifiedWindsurfModel("windsurf/gpt4o"), "windsurf/gpt4o");
});

test("Windsurf model helpers expose capabilities", () => {
  assert.equal(getWindsurfModelFromQualifiedId("windsurf/deepseek-reasoner")?.upstreamId, 206);
  assert.equal(windsurfModelSupportsReasoning("deepseek-reasoner"), true);
  assert.equal(windsurfModelSupportsReasoning("gpt4o"), false);
  assert.equal(windsurfModelUsesAutoToolChoice("gpt4o"), true);
  assert.equal(windsurfModelUsesAutoToolChoice("claude-3-5-sonnet"), false);
  assert.deepEqual(getWindsurfStopSequences("deepseek-chat"), [
    "<codebase_search>",
    "<write_to_file>",
    "<open_link>",
  ]);
  assert.deepEqual(getWindsurfStopSequences("gpt4o"), []);
});

test("Windsurf static display catalog matches the observed fallback list", () => {
  assert.deepEqual(
    WINDSURF_DISPLAY_CATALOG.map((model) => ({ id: model.id, name: model.name })),
    [
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
      { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
      { id: "swe-1.6", name: "SWE-1.6" },
      { id: "swe-1.6-fast", name: "SWE-1.6 Fast" },
      { id: "kimi-k2.6", name: "Kimi K2.6" },
      { id: "glm-5.1", name: "GLM-5.1" },
    ]
  );
});

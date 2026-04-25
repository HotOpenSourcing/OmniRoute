import test from "node:test";
import assert from "node:assert/strict";

import {
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

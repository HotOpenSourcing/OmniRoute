import test from "node:test";
import assert from "node:assert/strict";

import { resolveWindsurfBackend } from "../../src/lib/routing/windsurfBackendResolver";

test("resolveWindsurfBackend passes non-Windsurf providers through unchanged", () => {
  const result = resolveWindsurfBackend({
    requestedProvider: "openai",
    requestedModel: "gpt-5.4",
    body: { messages: [{ role: "user", content: "hello" }] },
    runtime: {
      lsOk: false,
      availableModels: [],
      source: "observed_health",
      modelDiscovery: { status: "missing", source: "none", reason: "not_provided" },
    },
  });

  assert.deepEqual(result, {
    requestedProvider: "openai",
    requestedModel: "gpt-5.4",
    effectiveProvider: "openai",
    effectiveModel: "gpt-5.4",
    reason: "non-windsurf provider bypasses backend resolver",
  });
});

test("resolveWindsurfBackend stabilizes Windsurf to windsurf-local when runtime is healthy and the model is available locally", () => {
  const result = resolveWindsurfBackend({
    requestedProvider: "windsurf",
    requestedModel: "claude-sonnet-4.6",
    body: { messages: [{ role: "user", content: "hello" }] },
    runtime: {
      lsOk: true,
      availableModels: ["claude-sonnet-4.6", "gpt4o"],
      source: "observed_health",
      modelDiscovery: { status: "present", source: "session/new" },
    },
  });

  assert.equal(result.effectiveProvider, "windsurf-local");
  assert.equal(result.effectiveModel, "claude-sonnet-4.6");
  assert.match(result.reason, /local/i);
});

test("resolveWindsurfBackend keeps Windsurf on cloud when runtime is unavailable", () => {
  const result = resolveWindsurfBackend({
    requestedProvider: "windsurf",
    requestedModel: "claude-sonnet-4.6",
    body: { messages: [{ role: "user", content: "hello" }] },
    runtime: {
      lsOk: false,
      availableModels: [],
      source: "observed_health",
      modelDiscovery: { status: "failed", source: "none", reason: "registry_failure" },
    },
  });

  assert.equal(result.effectiveProvider, "windsurf");
  assert.equal(result.effectiveModel, "claude-sonnet-4.6");
  assert.match(result.reason, /cloud/i);
});

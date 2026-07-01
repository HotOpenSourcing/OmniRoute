import test from "node:test";
import assert from "node:assert/strict";

import { createWindsurfRuntimeInspector } from "../../src/lib/routing/windsurfRuntimeInspector";

test("runtime inspector reports healthy local runtime with discovered models", async () => {
  const inspector = createWindsurfRuntimeInspector({
    ttlMs: 60_000,
    now: () => 1_000,
    bootstrap: async () => ({
      sessionId: "ws-123",
      modes: { currentModeId: "normal" },
      configOptions: [],
      models: {
        availableModels: [
          { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", owned_by: "windsurf" },
          { id: "gpt4o", name: "GPT-4o", owned_by: "windsurf" },
        ],
        currentModelId: "claude-sonnet-4.6",
      },
      modelDiscovery: {
        status: "present",
        source: "session/new",
      },
      diagnostics: {
        rpc: { requests: [], responses: [] },
        notifications: [],
        stderr: [],
      },
    }),
  });

  const result = await inspector.inspect({
    requestedModel: "claude-sonnet-4.6",
    credentials: { apiKey: "test-token" },
    cwd: "C:/Users/amine/OmniRoute",
  });

  assert.equal(result.lsOk, true);
  assert.equal(result.localModelAvailable, true);
  assert.deepEqual(result.availableModels, ["claude-sonnet-4.6", "gpt4o"]);
  assert.deepEqual(result.modelDiscovery, {
    status: "present",
    source: "session/new",
  });
  assert.deepEqual(result.diagnosticsSummary, {
    modelDiscoveryStatus: "present",
    modelDiscoverySource: "session/new",
    rpcRequestCount: 0,
    rpcResponseCount: 0,
    notificationCount: 0,
    stderrCount: 0,
  });
});

test("runtime inspector falls back cleanly when bootstrap fails", async () => {
  const inspector = createWindsurfRuntimeInspector({
    ttlMs: 60_000,
    now: () => 1_000,
    bootstrap: async () => {
      throw new Error("spawn failed");
    },
  });

  const result = await inspector.inspect({
    requestedModel: "claude-sonnet-4.6",
    credentials: { apiKey: "test-token" },
    cwd: "C:/Users/amine/OmniRoute",
  });

  assert.equal(result.lsOk, false);
  assert.equal(result.localModelAvailable, false);
  assert.deepEqual(result.availableModels, []);
  assert.deepEqual(result.modelDiscovery, {
    status: "failed",
    source: "none",
    reason: "unknown",
  });
  assert.deepEqual(result.diagnosticsSummary, {
    modelDiscoveryStatus: "failed",
    modelDiscoverySource: "none",
  });
  assert.match(result.reason, /fallback/i);
});

import test from "node:test";
import assert from "node:assert/strict";

import { ExecutionAdapter } from "../../src/lib/routing/executionAdapter";

class FakeExecutor {
  constructor(readonly name: string) {}

  execute() {
    return this.name;
  }
}

test("ExecutionAdapter resolves local_ls to local executor for local-only providers", () => {
  const adapter = new ExecutionAdapter({
    getLocalExecutor: () => new FakeExecutor("local"),
    getCloudExecutor: () => new FakeExecutor("cloud"),
    getHybridExecutor: () => new FakeExecutor("hybrid"),
  });

  const executor = adapter.resolve({
    provider: "windsurf-local",
    primary: "local_ls",
    locked: true,
    reason: "requiresLocal",
    trace: {
      modelId: "windsurf-local/claude-sonnet-4.6",
      primaryBackend: "local_ls",
      reason: "requiresLocal",
    },
  });

  assert.equal(executor.name, "local");
});

test("ExecutionAdapter resolves hybrid to hybrid executor", () => {
  const adapter = new ExecutionAdapter({
    getLocalExecutor: () => new FakeExecutor("local"),
    getCloudExecutor: () => new FakeExecutor("cloud"),
    getHybridExecutor: () => new FakeExecutor("hybrid"),
  });

  const executor = adapter.resolve({
    provider: "windsurf",
    primary: "hybrid",
    fallback: "cloud_api",
    locked: true,
    reason: "hybrid model requires split execution",
    trace: {
      modelId: "windsurf/hybrid-model",
      primaryBackend: "hybrid",
      fallbackBackend: "cloud_api",
      reason: "hybrid model requires split execution",
    },
  });

  assert.equal(executor.name, "hybrid");
});

test("ExecutionAdapter resolves cloud_api to cloud executor", () => {
  const adapter = new ExecutionAdapter({
    getLocalExecutor: () => new FakeExecutor("local"),
    getCloudExecutor: () => new FakeExecutor("cloud"),
    getHybridExecutor: () => new FakeExecutor("hybrid"),
  });

  const executor = adapter.resolve({
    provider: "openai",
    primary: "cloud_api",
    locked: true,
    reason: "cloud_only model",
    trace: {
      modelId: "openai/gpt-5.4",
      primaryBackend: "cloud_api",
      reason: "cloud_only model",
    },
  });

  assert.equal(executor.name, "cloud");
});

test("ExecutionAdapter throws when provider is missing", () => {
  const adapter = new ExecutionAdapter({
    getLocalExecutor: () => new FakeExecutor("local"),
    getCloudExecutor: () => new FakeExecutor("cloud"),
    getHybridExecutor: () => new FakeExecutor("hybrid"),
  });

  assert.throws(
    () =>
      adapter.resolve({
        provider: "   ",
        primary: "cloud_api",
        locked: true,
        reason: "cloud_only model",
        trace: {
          modelId: "openai/gpt-5.4",
          primaryBackend: "cloud_api",
          reason: "cloud_only model",
        },
      }),
    /provider/i
  );
});

test("ExecutionAdapter resolves local_ls when planning already stabilized windsurf to windsurf-local", () => {
  const adapter = new ExecutionAdapter({
    getLocalExecutor: () => new FakeExecutor("local"),
    getCloudExecutor: () => new FakeExecutor("cloud"),
    getHybridExecutor: () => new FakeExecutor("hybrid"),
  });

  const executor = adapter.resolve({
    provider: "windsurf-local",
    primary: "local_ls",
    fallback: "cloud_api",
    locked: true,
    reason: "effective provider was stabilized to windsurf-local",
    trace: {
      modelId: "windsurf-local/claude-sonnet-4.6",
      primaryBackend: "local_ls",
      fallbackBackend: "cloud_api",
      reason: "effective provider was stabilized to windsurf-local",
    },
  });

  assert.equal(executor.name, "local");
});

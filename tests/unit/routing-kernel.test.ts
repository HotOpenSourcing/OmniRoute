import test from "node:test";
import assert from "node:assert/strict";

import type { RouteDecision } from "../../src/lib/routing/types";
import { buildRoutingContext } from "../../src/lib/routing/context";
import { RoutingKernel } from "../../src/lib/routing/kernel";

test("RouteDecision is immutable and locked", () => {
  const decision: RouteDecision = {
    provider: "windsurf",
    primary: "cloud_api",
    fallback: "local_ls",
    locked: true,
    reason: "premium request prefers cloud",
    trace: {
      modelId: "windsurf/claude-sonnet-4.6",
      primaryBackend: "cloud_api",
      fallbackBackend: "local_ls",
      reason: "premium request prefers cloud",
    },
  };

  assert.equal(decision.locked, true);
  assert.equal(decision.provider, "windsurf");
  assert.equal(decision.primary, "cloud_api");
  assert.equal(decision.fallback, "local_ls");
  assert.deepEqual(decision.trace, {
    modelId: "windsurf/claude-sonnet-4.6",
    primaryBackend: "cloud_api",
    fallbackBackend: "local_ls",
    reason: "premium request prefers cloud",
  });
});

const kernel = new RoutingKernel();

test("requiresLocal routes to local_ls when LS is healthy", () => {
  const decision = kernel.route({
    modelId: "windsurf/claude-sonnet-4.6",
    provider: "windsurf",
    executionMode: "prefer_local",
    requiresLocal: true,
    supportsLocal: true,
    supportsCloud: true,
    isPremium: false,
    toolCalling: false,
    runtime: { lsOk: true, cloudOk: true, source: "observed_health" },
  });

  assert.equal(decision.primary, "local_ls");
  assert.equal(decision.fallback, "cloud_api");
  assert.equal(decision.locked, true);
});

test("tool calling routes to cloud_api", () => {
  const decision = kernel.route({
    modelId: "windsurf/claude-sonnet-4.6",
    provider: "windsurf",
    executionMode: "prefer_local",
    requiresLocal: false,
    supportsLocal: true,
    supportsCloud: true,
    isPremium: false,
    toolCalling: true,
    runtime: { lsOk: true, cloudOk: true, source: "observed_health" },
  });

  assert.equal(decision.primary, "cloud_api");
});

test("hybrid models route to hybrid with explicit cloud fallback", () => {
  const decision = kernel.route({
    modelId: "windsurf/hybrid-model",
    provider: "windsurf",
    executionMode: "hybrid",
    requiresLocal: false,
    supportsLocal: true,
    supportsCloud: true,
    isPremium: false,
    toolCalling: false,
    runtime: { lsOk: true, cloudOk: true, source: "observed_health" },
  });

  assert.equal(decision.primary, "hybrid");
  assert.equal(decision.fallback, "cloud_api");
});

test("cloud_only routes to cloud_api", () => {
  const decision = kernel.route({
    modelId: "openai/gpt-5.4",
    provider: "openai",
    executionMode: "cloud_only",
    requiresLocal: false,
    supportsLocal: false,
    supportsCloud: true,
    isPremium: false,
    toolCalling: false,
    runtime: { lsOk: false, cloudOk: true, source: "observed_health" },
  });

  assert.equal(decision.primary, "cloud_api");
  assert.equal(decision.fallback, undefined);
});

test("buildRoutingContext derives cloud_only and premium from canonical metadata for plain windsurf", () => {
  const context = buildRoutingContext({
    provider: "windsurf",
    model: "claude-sonnet-4.6",
    body: { messages: [{ role: "user", content: "hello" }] },
  });

  assert.equal(context.modelId, "windsurf/claude-sonnet-4.6");
  assert.equal(context.executionMode, "cloud_only");
  assert.equal(context.requiresLocal, false);
  assert.equal(context.supportsLocal, false);
  assert.equal(context.supportsCloud, true);
  assert.equal(context.isPremium, true);
  assert.equal(context.toolCalling, false);
  assert.deepEqual(context.runtime, {
    lsOk: false,
    cloudOk: true,
    source: "capability_defaults",
  });
});

test("buildRoutingContext derives local-only and tool-calling signals without ad-hoc model checks", () => {
  const context = buildRoutingContext({
    provider: "windsurf-local",
    model: "claude-sonnet-4.6",
    body: {
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", function: { name: "lookup", parameters: {} } }],
    },
  });

  assert.equal(context.executionMode, "local_only");
  assert.equal(context.requiresLocal, true);
  assert.equal(context.supportsLocal, true);
  assert.equal(context.supportsCloud, false);
  assert.equal(context.toolCalling, true);
  assert.equal(context.runtime.source, "capability_defaults");
});

test("requiresLocal with no cloud support stays on local_ls even when LS is unhealthy", () => {
  const decision = kernel.route({
    modelId: "windsurf-local/claude-sonnet-4.6",
    provider: "windsurf-local",
    executionMode: "local_only",
    requiresLocal: true,
    supportsLocal: true,
    supportsCloud: false,
    isPremium: false,
    toolCalling: false,
    runtime: { lsOk: false, cloudOk: false, source: "observed_health" },
  });

  assert.equal(decision.primary, "local_ls");
  assert.equal(decision.fallback, undefined);
  assert.equal(decision.reason, "requiresLocal model remains local because cloud is unsupported");
});

test("RoutingKernel returns frozen decisions and trace objects", () => {
  const decision = kernel.route({
    modelId: "windsurf/claude-sonnet-4.6",
    provider: "windsurf",
    executionMode: "prefer_local",
    requiresLocal: false,
    supportsLocal: true,
    supportsCloud: true,
    isPremium: true,
    toolCalling: false,
    runtime: { lsOk: true, cloudOk: true, source: "observed_health" },
  });

  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.trace), true);
});

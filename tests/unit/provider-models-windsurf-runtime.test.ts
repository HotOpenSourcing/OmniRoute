import test from "node:test";
import assert from "node:assert/strict";

test("resolveWindsurfModelsSource prefers ACP runtime discovery over the local catalog", async () => {
  const runtimeModels = [
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", owned_by: "windsurf" },
    { id: "o4-mini", name: "o4-mini", owned_by: "windsurf" },
  ];

  const providerModelsRoute = await import("../../src/app/api/providers/[id]/models/route.ts");

  assert.equal(typeof providerModelsRoute.resolveWindsurfModelsSource, "function");

  const result = await providerModelsRoute.resolveWindsurfModelsSource(
    {
      provider: "windsurf",
      authType: "oauth",
      accessToken: "windsurf-access",
      apiKey: null,
      providerSpecificData: {
        apiServerUrl: "https://server.codeium.com",
      },
    },
    {
      bootstrapWindsurfSession: async () => ({
        sessionId: "windsurf-test-session",
        modes: {},
        configOptions: [],
        models: {
          availableModels: runtimeModels,
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
    }
  );

  assert.equal(result.source, "acp_runtime");
  assert.deepEqual(result.models, [
    {
      id: "claude-sonnet-4.6",
      name: "Claude Sonnet 4.6",
      owned_by: "windsurf",
      displayable: true,
      authorized: true,
      executable: true,
      reason: "runtime model discovered from Windsurf session",
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      owned_by: "windsurf",
      displayable: true,
      authorized: true,
      executable: true,
      reason: "runtime model discovered from Windsurf session",
    },
  ]);
  assert.deepEqual(result.discovery, {
    status: "present",
    source: "session/new",
    transport: "acp_runtime",
  });
});

test("resolveWindsurfModelsSource labels load/resume discovery as a dynamic fallback instead of primary ACP", async () => {
  const runtimeModels = [{ id: "claude-opus-4.7", name: "Claude Opus 4.7", owned_by: "windsurf" }];

  const providerModelsRoute = await import("../../src/app/api/providers/[id]/models/route.ts");

  const result = await providerModelsRoute.resolveWindsurfModelsSource(
    {
      provider: "windsurf",
      authType: "oauth",
      accessToken: "windsurf-access",
      apiKey: null,
      providerSpecificData: {
        apiServerUrl: "https://server.codeium.com",
      },
    },
    {
      bootstrapWindsurfSession: async () => ({
        sessionId: "windsurf-test-session",
        modes: {},
        configOptions: [],
        models: {
          availableModels: runtimeModels,
          currentModelId: "claude-opus-4.7",
        },
        modelDiscovery: {
          status: "enriched",
          source: "session/load",
        },
        diagnostics: {
          rpc: { requests: [], responses: [] },
          notifications: [],
          stderr: [],
        },
      }),
    }
  );

  assert.equal(result.source, "session_runtime");
  assert.deepEqual(result.models, [
    {
      id: "claude-opus-4.7",
      name: "Claude Opus 4.7",
      owned_by: "windsurf",
      displayable: true,
      authorized: true,
      executable: true,
      reason: "runtime model discovered from Windsurf session",
    },
  ]);
  assert.deepEqual(result.discovery, {
    status: "enriched",
    source: "session/load",
    transport: "session_runtime",
  });
});

test("resolveWindsurfModelsSource exposes local catalog discovery metadata when runtime lookup is unavailable", async () => {
  const providerModelsRoute = await import("../../src/app/api/providers/[id]/models/route.ts");

  const result = await providerModelsRoute.resolveWindsurfModelsSource(
    {
      provider: "windsurf",
      authType: "oauth",
      accessToken: null,
      apiKey: null,
      providerSpecificData: {
        apiServerUrl: "https://server.codeium.com",
      },
    },
    {
      bootstrapWindsurfSession: async () => {
        throw new Error("should not be called without credentials");
      },
    }
  );

  assert.equal(result.source, "local_catalog");
  assert.ok(Array.isArray(result.models));
  assert.ok(result.models.length > 0);
  assert.deepEqual(result.models[0], {
    id: result.models[0].id,
    name: result.models[0].name,
    owned_by: "windsurf",
    displayable: true,
    authorized: false,
    executable: false,
    reason: "catalog fallback because runtime model authorization is unavailable",
  });
  assert.deepEqual(result.discovery, {
    status: "missing",
    source: "none",
    transport: "local_catalog",
  });
});

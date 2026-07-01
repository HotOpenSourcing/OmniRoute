import test from "node:test";
import assert from "node:assert/strict";

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.ts");
const { setCustomAliases } = await import("../../open-sse/services/modelDeprecation.ts");

function noopLog() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

test.beforeEach(() => {
  setCustomAliases({});
});

test.afterEach(() => {
  setCustomAliases({});
});

test("chatCore executes the executor resolved from routing deps", async () => {
  let localCalls = 0;
  let observedRouteContext = null;
  let observedRequestedIdentity = null;
  const localExecutor = {
    async execute() {
      localCalls += 1;
      return {
        response: new Response(
          JSON.stringify({
            id: "chatcmpl-local",
            object: "chat.completion",
            model: "windsurf-local-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "local" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
        url: "local://windsurf",
        headers: { "content-type": "application/json" },
        transformedBody: { ok: true },
      };
    },
    async refreshCredentials() {
      return null;
    },
  };

  const result = await handleChatCore({
    body: {
      model: "windsurf/claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
    },
    modelInfo: {
      provider: "windsurf",
      model: "claude-sonnet-4.6",
      extendedContext: false,
    },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: noopLog(),
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: {
        model: "windsurf/claude-sonnet-4.6",
        messages: [{ role: "user", content: "hello" }],
      },
      headers: new Headers({ accept: "application/json" }),
    },
    routingDeps: {
      async inspectWindsurfRuntime() {
        return {
          lsOk: true,
          localModelAvailable: true,
          availableModels: ["claude-sonnet-4.6"],
          source: "observed_health",
          modelDiscovery: {
            status: "present",
            source: "session/new",
          },
          reason: "test local runtime available",
        };
      },
      async resolveExecutionPlan(input) {
        observedRouteContext = input;
        observedRequestedIdentity = {
          provider: input.request.requestedProvider || input.request.provider,
          model: input.request.requestedModel || input.request.model,
        };
        return {
          decision: {
            provider: "windsurf-local",
            primary: "local_ls",
            fallback: "cloud_api",
            locked: true,
            reason: "test forced local routing",
            trace: {
              modelId: "windsurf-local/claude-sonnet-4.6",
              primaryBackend: "local_ls",
              fallbackBackend: "cloud_api",
              reason: "test forced local routing",
            },
          },
          executor: localExecutor,
        };
      },
    },
  });

  assert.equal(localCalls, 1);
  assert.equal(result.success, true);
  assert.ok(result.response instanceof Response);
  assert.equal(result.response.status, 200);
  assert.deepEqual(observedRequestedIdentity, {
    provider: "windsurf",
    model: "claude-sonnet-4.6",
  });
  assert.deepEqual(observedRouteContext, {
    routeContext: {
      modelId: "windsurf-local/claude-sonnet-4.6",
      provider: "windsurf-local",
      executionMode: "local_only",
      requiresLocal: true,
      supportsLocal: true,
      supportsCloud: false,
      isPremium: true,
      toolCalling: false,
      runtime: {
        lsOk: true,
        cloudOk: false,
        source: "capability_defaults",
      },
    },
    request: {
      provider: "windsurf-local",
      model: "claude-sonnet-4.6",
      requestedProvider: "windsurf",
      requestedModel: "claude-sonnet-4.6",
      body: {
        model: "windsurf/claude-sonnet-4.6",
        messages: [{ role: "user", content: "hello" }],
      },
    },
  });
});

test("chatCore builds routing context from effective aliased model", async () => {
  setCustomAliases({ "alias-source": "alias-target" });

  let observedRouteContext = null;
  let observedRequestedIdentity = null;
  const localExecutor = {
    async execute() {
      return {
        response: new Response(
          JSON.stringify({
            id: "chatcmpl-local",
            object: "chat.completion",
            model: "windsurf-local-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "local" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        ),
        url: "local://windsurf",
        headers: { "content-type": "application/json" },
        transformedBody: { ok: true },
      };
    },
    async refreshCredentials() {
      return null;
    },
  };

  const result = await handleChatCore({
    body: {
      model: "alias-target",
      messages: [{ role: "user", content: "hello" }],
    },
    modelInfo: {
      provider: "windsurf",
      model: "alias-source",
      extendedContext: false,
    },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    log: noopLog(),
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: {
        model: "alias-target",
        messages: [{ role: "user", content: "hello" }],
      },
      headers: new Headers({ accept: "application/json" }),
    },
    routingDeps: {
      async resolveExecutionPlan(input) {
        observedRouteContext = input;
        return {
          decision: {
            provider: "windsurf",
            primary: "local_ls",
            fallback: "cloud_api",
            locked: true,
            reason: "test forced local routing",
            trace: {
              modelId: "windsurf/alias-target",
              primaryBackend: "local_ls",
              fallbackBackend: "cloud_api",
              reason: "test forced local routing",
            },
          },
          executor: localExecutor,
        };
      },
    },
  });

  assert.equal(result.success, true);
  assert.ok(result.response instanceof Response);
  assert.equal(result.response.status, 200);
  assert.equal(observedRouteContext.request.provider, "windsurf");
  assert.equal(observedRouteContext.request.model, "alias-target");
  assert.deepEqual(observedRouteContext.request.body, {
    model: "alias-target",
    messages: [{ role: "user", content: "hello" }],
  });
  assert.equal(observedRouteContext.routeContext.modelId, "windsurf/alias-target");
  assert.equal(observedRouteContext.routeContext.provider, "windsurf");
  assert.equal(observedRouteContext.routeContext.executionMode, "prefer_local");
  assert.equal(observedRouteContext.routeContext.requiresLocal, false);
  assert.equal(observedRouteContext.routeContext.supportsLocal, true);
  assert.equal(observedRouteContext.routeContext.supportsCloud, true);
  assert.equal(observedRouteContext.routeContext.toolCalling, false);
  assert.deepEqual(observedRouteContext.routeContext.runtime, {
    lsOk: true,
    cloudOk: true,
    source: "capability_defaults",
  });
});

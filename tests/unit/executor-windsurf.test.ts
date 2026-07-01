import test from "node:test";
import assert from "node:assert/strict";

import {
  getCloudExecutor,
  getHybridExecutor,
  getLocalExecutor,
  hasSpecializedExecutor,
} from "../../open-sse/executors/index.ts";
import { WindsurfExecutor } from "../../open-sse/executors/windsurf.ts";
import { WindsurfLocalExecutor } from "../../open-sse/executors/windsurfLocal.ts";
import { WindsurfHybridExecutor } from "../../open-sse/executors/windsurfHybrid.ts";
import { decodeMessage, parseConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.ts";

test("Windsurf executors are registered in executor index", () => {
  assert.ok(hasSpecializedExecutor("windsurf"));
  assert.ok(hasSpecializedExecutor("ws"));
  assert.ok(getCloudExecutor("windsurf") instanceof WindsurfExecutor);
  assert.ok(getCloudExecutor("ws") instanceof WindsurfExecutor);
  assert.ok(getLocalExecutor("windsurf") instanceof WindsurfLocalExecutor);
  assert.ok(getHybridExecutor("windsurf") instanceof WindsurfHybridExecutor);
});

test("cloud executor resolution throws for unsupported providers", () => {
  assert.throws(() => getCloudExecutor("definitely-unsupported-provider"), /executor|provider/i);
});

test("WindsurfExecutor builds Connect protocol URL and headers", () => {
  const executor = new WindsurfExecutor();
  const headers = executor.buildHeaders({ apiKey: "test-token" });

  assert.equal(
    executor.buildUrl(),
    "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage"
  );
  assert.equal(headers["content-type"], "application/connect+proto");
  assert.equal(headers["connect-protocol-version"], "1");
  assert.equal(headers["connect-accept-encoding"], "gzip");
});

test("WindsurfExecutor rejects missing credentials before protocol dispatch", async () => {
  const executor = new WindsurfExecutor();
  const result = await executor.execute({
    model: "gpt4o",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    credentials: {},
    signal: null,
    log: null,
  });

  assert.equal(result.response.status, 401);
  const json = await result.response.json();
  assert.equal(json.error.type, "authentication_error");
  assert.equal(json.error.code, "token_required");
});

test("WindsurfExecutor dispatches a framed Connect protobuf request with normalized chat_model_name", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, options = {}) => {
    captured = {
      url: String(url),
      headers: options.headers,
      body: options.body,
      method: options.method,
    };

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const executor = new WindsurfExecutor();
    const result = await executor.execute({
      model: "windsurf/claude-sonnet-4.6",
      body: {
        model: "windsurf/claude-sonnet-4.6",
        messages: [{ role: "user", content: "hello" }],
      },
      stream: true,
      credentials: { apiKey: "test-token" },
      signal: null,
      log: null,
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(result.transformedBody, {
      model: "claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(captured?.url, "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage");
    assert.equal(captured?.method, "POST");
    assert.equal(captured?.headers.Authorization, "Bearer test-token");
    assert.equal(captured?.headers["content-type"], "application/connect+proto");
    assert.ok(captured?.body instanceof Uint8Array);

    const frame = parseConnectRPCFrame(new Uint8Array(captured.body));
    assert.ok(frame);
    assert.equal(frame.flags, 0);

    const topLevel = decodeMessage(frame.payload);
    const requestField = topLevel.get(1)?.[0];
    assert.ok(requestField, "expected top-level request field");

    const rawRequest = decodeMessage(requestField.value);
    const chatModelNameField = rawRequest.get(5)?.[0];
    assert.ok(chatModelNameField, "expected chat_model_name field");
    assert.equal(new TextDecoder().decode(chatModelNameField.value), "claude-sonnet-4.6");

    const chatMessages = rawRequest.get(2) || [];
    assert.equal(chatMessages.length, 1);
    const firstChatMessage = decodeMessage(chatMessages[0].value);
    assert.equal(new TextDecoder().decode(firstChatMessage.get(3)?.[0]?.value || new Uint8Array()), "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WindsurfLocalExecutor delegates to the cloud executor while preserving the local provider identity", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, options = {}) => {
    captured = {
      url: String(url),
      headers: options.headers,
      body: String(options.body || ""),
      method: options.method,
    };

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const executor = new WindsurfLocalExecutor();
    const result = await executor.execute({
      model: "windsurf-local/claude-sonnet-4.6",
      body: {
        model: "windsurf-local/claude-sonnet-4.6",
        messages: [{ role: "user", content: "hello" }],
      },
      stream: true,
      credentials: { apiKey: "test-token" },
      signal: null,
      log: null,
    });

    assert.equal(result.response.status, 200);
    assert.equal(executor.getProvider(), "windsurf-local");
    assert.deepEqual(result.transformedBody, {
      model: "claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(captured?.url, "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage");
    assert.equal(captured?.headers.Authorization, "Bearer test-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WindsurfHybridExecutor delegates to the cloud executor while preserving the hybrid provider identity", async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, options = {}) => {
    captured = {
      url: String(url),
      headers: options.headers,
      body: String(options.body || ""),
      method: options.method,
    };

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const executor = new WindsurfHybridExecutor();
    const result = await executor.execute({
      model: "windsurf-hybrid/claude-sonnet-4.6",
      body: {
        model: "windsurf-hybrid/claude-sonnet-4.6",
        messages: [{ role: "user", content: "hello" }],
      },
      stream: true,
      credentials: { apiKey: "test-token" },
      signal: null,
      log: null,
    });

    assert.equal(result.response.status, 200);
    assert.equal(executor.getProvider(), "windsurf-hybrid");
    assert.deepEqual(result.transformedBody, {
      model: "claude-sonnet-4.6",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(captured?.url, "https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage");
    assert.equal(captured?.headers.Authorization, "Bearer test-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

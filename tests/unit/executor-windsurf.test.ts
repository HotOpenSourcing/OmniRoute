import test from "node:test";
import assert from "node:assert/strict";

import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.ts";
import { WindsurfExecutor } from "../../open-sse/executors/windsurf.ts";

test("WindsurfExecutor is registered in executor index", () => {
  assert.ok(hasSpecializedExecutor("windsurf"));
  assert.ok(hasSpecializedExecutor("ws"));
  assert.ok(getExecutor("windsurf") instanceof WindsurfExecutor);
  assert.ok(getExecutor("ws") instanceof WindsurfExecutor);
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
  assert.equal(headers["connect-content-encoding"], "gzip");
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

test("WindsurfExecutor returns an explicit protocol-phase error with credentials", async () => {
  const executor = new WindsurfExecutor();
  const result = await executor.execute({
    model: "gpt4o",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: true,
    credentials: { apiKey: "test-token" },
    signal: null,
    log: null,
  });

  assert.equal(result.response.status, 501);
  const json = await result.response.json();
  assert.equal(json.error.type, "provider_error");
  assert.equal(json.error.code, "windsurf_protocol_not_implemented");
});

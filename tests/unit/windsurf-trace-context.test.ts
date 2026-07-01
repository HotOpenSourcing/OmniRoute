import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTraceContext, TRACE_NOT_OBSERVED } = require("../../scripts/scratch/windsurf-trace-context.cjs");

test("createTraceContext creates and reuses trace ids", async () => {
  const traces = createTraceContext();

  const generated = traces.startProviderTrace({
    vendor: "windsurf",
    method: "provideLanguageModelChatResponse",
    observedArgs: [{ info: { model: "claude-sonnet-4.6" } }],
  });

  assert.equal(typeof generated.traceId, "string");
  assert.equal(generated.traceId.length > 10, true);

  const reused = traces.startProviderTrace({
    vendor: "windsurf",
    method: "provideLanguageModelChatResponse",
    observedArgs: [{ trace_id: "trace-fixed", info: { model: "claude-sonnet-4.6" } }],
  });

  assert.equal(reused.traceId, "trace-fixed");
  assert.equal(TRACE_NOT_OBSERVED, "NOT OBSERVED");
});

test("createTraceContext preserves active trace across awaited work", async () => {
  const traces = createTraceContext();
  const started = traces.startProviderTrace({
    vendor: "windsurf",
    method: "provideLanguageModelChatResponse",
    observedArgs: [{ info: { model: "claude-sonnet-4.6" } }],
  });

  const seen = await traces.runWithTrace(started.traceId, async () => {
    await Promise.resolve();
    return traces.getActiveTraceId();
  });

  assert.equal(seen, started.traceId);
});

test("createTraceContext stores and resolves rpc call id mappings", () => {
  const traces = createTraceContext();
  traces.bindRpcCall("rpc-17", "trace-17");

  assert.equal(traces.getTraceIdForRpcCall("rpc-17"), "trace-17");
  assert.equal(traces.getTraceIdForRpcCall("rpc-missing"), "NOT OBSERVED");
});

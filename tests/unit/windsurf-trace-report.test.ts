import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createTraceReportBuilder } = require("../../scripts/scratch/windsurf-trace-report.cjs");

test("report builder attributes first sink only when trace ids match", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({
    trace_id: "trace-1",
    method: "provideLanguageModelChatResponse",
    observed_args: { model: "claude-sonnet-4.6" },
  });
  reports.recordTransportEvent({
    trace_id: "trace-1",
    type: "HTTP",
    target: "http://127.0.0.1:50341/chat",
    timestamp: "2026-04-29T10:00:00.000Z",
  });

  const report = reports.buildTraceReport("trace-1");
  assert.equal(report.first_sink.type, "HTTP");
  assert.equal(report.first_sink.target, "http://127.0.0.1:50341/chat");
});

test("report builder returns NOT OBSERVED when no matching sink exists", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({
    trace_id: "trace-2",
    method: "provideLanguageModelChatResponse",
    observed_args: { model: "claude-sonnet-4.6" },
  });
  reports.recordTransportEvent({
    trace_id: "trace-other",
    type: "HTTP",
    target: "http://127.0.0.1:50341/chat",
    timestamp: "2026-04-29T10:00:01.000Z",
  });

  const report = reports.buildTraceReport("trace-2");
  assert.equal(report.first_sink.type, "NOT OBSERVED");
  assert.equal(report.native_correlation.observed, false);
});

test("report builder computes observability metrics across traces", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({ trace_id: "a", method: "provideLanguageModelChatResponse", observed_args: {} });
  reports.recordProviderEntry({ trace_id: "b", method: "provideLanguageModelChatResponse", observed_args: {} });
  reports.recordTransportEvent({ trace_id: "a", type: "IPC", target: "localhost:50341", timestamp: "2026-04-29T10:00:00.000Z" });

  const metrics = reports.buildMetrics(["a", "b"]);
  assert.equal(metrics.first_sink_observability_rate, "1/2");
  assert.equal(metrics.trace_propagation_status_by_trace.a, "COMPLETE");
});

test("report builder marks mixed success as partial observability", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({ trace_id: "same-model-small", method: "provideLanguageModelChatResponse", observed_args: { model: "claude-sonnet-4.6" } });
  reports.recordProviderEntry({ trace_id: "different-model", method: "provideLanguageModelChatResponse", observed_args: { model: "gpt-4o" } });
  reports.recordProviderEntry({ trace_id: "tools-on", method: "provideLanguageModelChatResponse", observed_args: { model: "claude-sonnet-4.6", tools: [{}] } });

  reports.recordTransportEvent({ trace_id: "same-model-small", type: "IPC", target: "localhost:50341", timestamp: "2026-04-29T10:00:00.000Z" });
  reports.recordTransportEvent({ trace_id: "tools-on", type: "HTTP", target: "https://example.invalid/chat", timestamp: "2026-04-29T10:00:02.000Z" });

  const metrics = reports.buildMetrics(["same-model-small", "different-model", "tools-on"]);
  assert.equal(metrics.first_sink_observability_rate, "2/3");
  assert.equal(metrics.trace_propagation_status_by_trace["different-model"], "BROKEN");
  assert.deepEqual(metrics.broken_points_by_trace["different-model"], ["downstream_transport_or_inference"]);
});

test("shadow lifecycle builder segments reset boundaries into independent graphs", () => {
  const reports = createTraceReportBuilder();

  reports.recordLifecycleEvent({
    target_id: "target-a",
    timestamp: "2026-05-02T12:00:00.000Z",
    event: "Runtime.executionContextCreated",
    renderer_pid: 111,
  });
  reports.recordLifecycleEvent({
    target_id: "target-a",
    timestamp: "2026-05-02T12:00:01.000Z",
    event: "Page.frameNavigated",
  });
  reports.recordLifecycleEvent({
    target_id: "target-a",
    timestamp: "2026-05-02T12:00:02.000Z",
    event: "bridge-response",
    bridge_name: "window.api",
  });
  reports.recordLifecycleEvent({
    target_id: "target-a",
    timestamp: "2026-05-02T12:00:03.000Z",
    event: "Network.requestWillBeSent",
    request_url: "https://example.invalid/bootstrap",
  });
  reports.recordLifecycleEvent({
    target_id: "target-a",
    timestamp: "2026-05-02T12:00:04.000Z",
    event: "Runtime.executionContextDestroyed",
  });
  reports.recordLifecycleEvent({
    target_id: "target-b",
    timestamp: "2026-05-02T12:00:05.000Z",
    event: "Runtime.executionContextCreated",
    renderer_pid: 222,
  });
  reports.recordLifecycleEvent({
    target_id: "target-b",
    timestamp: "2026-05-02T12:00:06.000Z",
    event: "Page.frameNavigated",
  });

  const graphs = reports.buildShadowLifecycleGraphs();

  assert.equal(graphs.length, 2);
  assert.equal(graphs[0].graph_id, "G1");
  assert.equal(graphs[0].state_table.t4_app_ready_inferred.status, "YES");
  assert.equal(graphs[0].conclusion.app_ready_inferred, "YES");
  assert.equal(graphs[0].conclusion.browser_window_stable, "NO");
  assert.equal(graphs[1].graph_id, "G2");
  assert.equal(graphs[1].state_table.t2_ipc_bridge_live.status, "absent");
  assert.equal(graphs[1].conclusion.app_ready_inferred, "NO");
  assert.deepEqual(graphs[0].reset_boundaries, [
    {
      timestamp: "2026-05-02T12:00:04.000Z",
      reason: "Runtime.executionContextDestroyed",
      type: "hard",
    },
  ]);
});

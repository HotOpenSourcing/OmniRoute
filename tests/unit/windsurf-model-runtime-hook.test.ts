import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createTraceContext,
  TRACE_NOT_OBSERVED,
} = require("../../scripts/scratch/windsurf-trace-context.cjs");
const { createTraceReportBuilder } = require("../../scripts/scratch/windsurf-trace-report.cjs");
const {
  createProviderWrapper,
  createRpcWrapper,
  createBootstrapState,
  observeLifecycleMethod,
} = require("../../scripts/scratch/windsurf-model-runtime-hook.cjs");

test("provider wrapper records provider entry and preserves trace id through awaited method", async () => {
  const traces = createTraceContext();
  const events: Array<Record<string, unknown>> = [];
  const provider = {
    async provideLanguageModelChatResponse(info: unknown) {
      await Promise.resolve();
      events.push({ insideTraceId: traces.getActiveTraceId(), info });
      return { ok: true };
    },
  };

  const wrappedProvider = createProviderWrapper({
    vendor: "windsurf",
    provider,
    traces,
    writeEvent(type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
  });

  await wrappedProvider.provideLanguageModelChatResponse({ metadata: { trace_id: "trace-hook" } });

  const bindingEvent = events.find((event) => event.type === "provider-binding");
  assert.equal(bindingEvent?.payload?.traceId, "trace-hook");
  assert.equal(bindingEvent?.payload?.providerSource, "local_host");
  assert.equal(bindingEvent?.payload?.providerMethod, "provideLanguageModelChatResponse");

  const callEvent = events.find((event) => event.type === "lm-provider-method-call");
  assert.equal(callEvent?.payload?.traceId, "trace-hook");
  assert.equal(events.find((event) => "insideTraceId" in event)?.insideTraceId, "trace-hook");
});

test("provider wrapper classifies ACP vendors as cloud provider sources", async () => {
  const traces = createTraceContext();
  const events: Array<Record<string, unknown>> = [];
  const provider = {
    async provideLanguageModelChatResponse(info: Record<string, unknown>) {
      return { echoedModel: info.model };
    },
  };

  const wrappedProvider = createProviderWrapper({
    vendor: "devin-cloud",
    provider,
    traces,
    writeEvent(type: string, payload: Record<string, unknown>) {
      events.push({ type, payload });
    },
  });

  await wrappedProvider.provideLanguageModelChatResponse({ model: "gpt-test", metadata: { trace_id: "trace-acp" } });

  const bindingEvent = events.find((event) => event.type === "provider-binding");
  assert.equal(bindingEvent?.payload?.providerSource, "acp_cloud");
  assert.equal(bindingEvent?.payload?.modelHint, "gpt-test");
  assert.deepEqual(bindingEvent?.payload?.payloadKeys, ["model", "metadata"]);
});

test("rpc wrappers bind call ids back to the active trace id", async () => {
  const traces = createTraceContext();
  const calls: Array<Record<string, unknown>> = [];

  const rpcTarget = {
    async $tryStartChatRequest(callId: string, payload: Record<string, unknown>) {
      calls.push({ callId, payload, traceId: traces.getTraceIdForRpcCall(callId) });
      return { ok: true };
    },
  };

  const wrappedRpc = createRpcWrapper({
    target: rpcTarget,
    traces,
    writeEvent(type: string, payload: Record<string, unknown>) {
      calls.push({ type, payload });
    },
  });

  await traces.runWithTrace("trace-rpc", async () => {
    await wrappedRpc.$tryStartChatRequest("rpc-42", { metadata: {} });
  });

  assert.equal(traces.getTraceIdForRpcCall("rpc-42"), "trace-rpc");
  assert.equal(calls.find((entry) => entry.callId === "rpc-42")?.traceId, "trace-rpc");
});

test("transport events inherit the active trace id and feed first-sink reports", async () => {
  const traces = createTraceContext();
  const reports = createTraceReportBuilder();
  const emitted: Array<Record<string, unknown>> = [];

  const writeTraceBoundEvent = (type: string, payload: Record<string, unknown>) => {
    const traceId = payload.traceId || traces.getActiveTraceId();
    emitted.push({ type, traceId, payload });
    if (type === "http-request") {
      reports.recordTransportEvent({
        trace_id: traceId,
        type: "HTTP",
        target: payload.target,
        timestamp: payload.timestamp,
      });
    }
  };

  await traces.runWithTrace("trace-http", async () => {
    writeTraceBoundEvent("http-request", {
      target: "http://127.0.0.1:50341/chat",
      timestamp: "2026-04-29T10:00:00.000Z",
    });
  });

  assert.equal(emitted[0].traceId, "trace-http");
  assert.equal(reports.buildTraceReport("trace-http").first_sink.type, "HTTP");
});

test("trace report keeps routing evidence separate from inference proof", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({
    trace_id: "trace-routing-only",
    method: "provideLanguageModelChatResponse",
    evidence_class: "provider_binding",
    provider_source: "local_host",
    timestamp: "2026-04-29T10:00:00.000Z",
  });
  reports.recordTransportEvent({
    trace_id: "trace-routing-only",
    type: "LS_OUTBOUND",
    target: "https://language-server.internal/chat",
    timestamp: "2026-04-29T10:00:01.000Z",
    evidence_class: "ls_outbound",
    surface: "language_server",
  });

  const report = reports.buildTraceReport("trace-routing-only");

  assert.equal(report.strongest_evidence.class, "ls_outbound");
  assert.equal(report.final_classification, "routing_observed_without_inference");
  assert.equal(report.inference_observed, false);
  assert.match(report.rationale, /no explicit inference/i);
});

test("trace report upgrades to inference observed when explicit P4 evidence exists", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({
    trace_id: "trace-p4",
    method: "provideLanguageModelChatResponse",
    evidence_class: "provider_binding",
    provider_source: "local_host",
    timestamp: "2026-04-29T10:00:00.000Z",
  });
  reports.recordTransportEvent({
    trace_id: "trace-p4",
    type: "HTTP_INFERENCE_REQUEST",
    target: "https://api.anthropic.com/v1/messages",
    timestamp: "2026-04-29T10:00:02.000Z",
    evidence_class: "inference_request",
    surface: "language_server",
  });

  const report = reports.buildTraceReport("trace-p4");

  assert.equal(report.strongest_evidence.class, "inference_request");
  assert.equal(report.final_classification, "inference_observed");
  assert.equal(report.inference_observed, true);
});

test("trace report marks missing transport after provider entry as partial observability", () => {
  const reports = createTraceReportBuilder();

  reports.recordProviderEntry({
    trace_id: "trace-partial",
    method: "provideLanguageModelChatResponse",
    evidence_class: "provider_binding",
    provider_source: "local_host",
    timestamp: "2026-04-29T10:00:00.000Z",
  });

  const report = reports.buildTraceReport("trace-partial");

  assert.equal(report.strongest_evidence.class, "provider_binding");
  assert.equal(report.final_classification, "unknown_partial_observability");
  assert.equal(report.inference_observed, false);
  assert.deepEqual(report.broken_or_unknown_points, ["downstream_transport_or_inference"]);
});

test("trace context resolves rpc-bound trace ids when async context is absent", () => {
  const traces = createTraceContext();

  traces.bindRpcCall("rpc-lost-context", "trace-rpc-fallback");

  assert.equal(traces.resolveTraceId({ rpcCallId: "rpc-lost-context" }), "trace-rpc-fallback");
  assert.equal(traces.resolveTraceId({ rpcCallId: "missing" }), TRACE_NOT_OBSERVED);
});

test("observeLifecycleMethod records first intercepted method and languageServerStarted payload", () => {
  const bootstrapState = createBootstrapState();
  const bootstrapEvents: Array<Record<string, unknown>> = [];
  const csrfEvents: Array<Record<string, unknown>> = [];

  observeLifecycleMethod({
    bootstrapState,
    methodName: "languageServerStarted",
    payload: {
      languageServerPort: 51234,
      host: "127.0.0.1",
      csrfToken: "csrf-1",
    },
    processSurface: "host",
    processPid: 4321,
    processPpid: 1234,
    traceId: "trace-ls",
    now: "2026-05-02T10:00:00.000Z",
    recordBootstrapStep(step: string, patch: Record<string, unknown>) {
      bootstrapEvents.push({ step, patch });
      Object.assign(bootstrapState, patch);
      bootstrapState.steps.push({ at: "2026-05-02T10:00:00.000Z", step, patch });
    },
    writeLiveCsrfEvent(event: string, payload: Record<string, unknown>) {
      csrfEvents.push({ event, payload });
    },
  });

  assert.equal(bootstrapState.firstInterceptedMethod, "languageServerStarted");
  assert.equal(bootstrapState.languageServerStartedSeen, true);
  assert.equal(bootstrapState.languageServerPort, 51234);
  assert.equal(bootstrapState.csrfToken, "csrf-1");
  assert.equal(bootstrapState.processPid, 4321);
  assert.equal(bootstrapState.processPpid, 1234);
  assert.deepEqual(bootstrapState.interceptedMethodsSample, ["languageServerStarted"]);
  assert.equal(bootstrapEvents.at(-1)?.step, "promiseClient.languageServerStarted");
  assert.equal(csrfEvents.at(-1)?.event, "languageServerStarted");
});

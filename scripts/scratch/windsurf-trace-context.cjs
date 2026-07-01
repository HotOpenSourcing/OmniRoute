const { AsyncLocalStorage } = require("node:async_hooks");
const crypto = require("node:crypto");

const TRACE_NOT_OBSERVED = "NOT OBSERVED";

function extractTraceId(observedArgs) {
  const first = Array.isArray(observedArgs) ? observedArgs[0] : null;
  if (first && typeof first === "object" && typeof first.trace_id === "string" && first.trace_id.length > 0) {
    return first.trace_id;
  }
  if (
    first &&
    typeof first === "object" &&
    first.metadata &&
    typeof first.metadata === "object" &&
    typeof first.metadata.trace_id === "string" &&
    first.metadata.trace_id.length > 0
  ) {
    return first.metadata.trace_id;
  }
  return crypto.randomUUID();
}

function createTraceContext() {
  const storage = new AsyncLocalStorage();
  const providerTraces = new Map();
  const rpcCallToTrace = new Map();
  const transportEventTrace = new Map();

  return {
    startProviderTrace(entry) {
      const traceId = extractTraceId(entry.observedArgs);
      const record = { traceId, ...entry };
      providerTraces.set(traceId, record);
      return record;
    },
    runWithTrace(traceId, fn) {
      return storage.run({ traceId }, fn);
    },
    getActiveTraceId() {
      return storage.getStore()?.traceId || TRACE_NOT_OBSERVED;
    },
    bindRpcCall(callId, traceId) {
      rpcCallToTrace.set(callId, traceId);
    },
    getTraceIdForRpcCall(callId) {
      return rpcCallToTrace.get(callId) || TRACE_NOT_OBSERVED;
    },
    bindTransportEvent(key, traceId) {
      if (typeof key === "string" && key.length > 0 && typeof traceId === "string" && traceId.length > 0) {
        transportEventTrace.set(key, traceId);
      }
    },
    getTraceIdForTransportEvent(key) {
      return transportEventTrace.get(key) || TRACE_NOT_OBSERVED;
    },
    resolveTraceId({ traceId, rpcCallId, transportKey } = {}) {
      if (typeof traceId === "string" && traceId.length > 0 && traceId !== TRACE_NOT_OBSERVED) {
        return traceId;
      }

      const activeTraceId = storage.getStore()?.traceId;
      if (typeof activeTraceId === "string" && activeTraceId.length > 0) {
        return activeTraceId;
      }

      if (typeof rpcCallId === "string" && rpcCallId.length > 0) {
        const rpcTraceId = rpcCallToTrace.get(rpcCallId);
        if (typeof rpcTraceId === "string" && rpcTraceId.length > 0) {
          return rpcTraceId;
        }
      }

      if (typeof transportKey === "string" && transportKey.length > 0) {
        const transportTraceId = transportEventTrace.get(transportKey);
        if (typeof transportTraceId === "string" && transportTraceId.length > 0) {
          return transportTraceId;
        }
      }

      return TRACE_NOT_OBSERVED;
    },
    getProviderTrace(traceId) {
      return providerTraces.get(traceId) || null;
    },
  };
}

module.exports = {
  createTraceContext,
  TRACE_NOT_OBSERVED,
};

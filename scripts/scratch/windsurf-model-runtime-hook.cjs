const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const childProcess = require("node:child_process");
const { createTraceContext, TRACE_NOT_OBSERVED } = require("./windsurf-trace-context.cjs");

const ROOT = "C:/Users/amine/OmniRoute";
const LOG_PATH = path.join(ROOT, "windsurf-model-runtime-capture.jsonl");
const AUTH_LOG_PATH = path.join(ROOT, "windsurf-auth-runtime-capture.jsonl");
const CSRF_LOG_PATH = path.join(ROOT, "windsurf-live-csrf-capture.jsonl");
const BOOTSTRAP_PATH = path.join(ROOT, "windsurf-live-bootstrap.json");
const STATE_DB = "C:/Users/amine/AppData/Roaming/Windsurf/User/globalStorage/state.vscdb";
const WINDSURF_DEBUG_ELECTRON = /^(1|true|yes)$/i.test(process.env.WINDSURF_DEBUG_ELECTRON ?? "");
const ELECTRON_DEBUG_PACKAGE = path.join(ROOT, "tools", "electron-debug", "index.js");

function createBootstrapState() {
  return {
    csrfToken: null,
    languageServerPort: null,
    languageServerUrl: null,
    apiUrl: null,
    host: "127.0.0.1",
    observedAt: null,
    hookInstalledAt: null,
    firstInterceptedMethod: null,
    languageServerStartedSeen: false,
    interceptedMethodsSample: [],
    processPid: process.pid,
    processPpid: typeof process.ppid === "number" ? process.ppid : null,
    processSurface: null,
    steps: [],
  };
}

const bootstrapState = globalThis.__WINDSURF_BOOTSTRAP || createBootstrapState();
globalThis.__WINDSURF_BOOTSTRAP = bootstrapState;
if (!bootstrapState.hookInstalledAt) {
  bootstrapState.hookInstalledAt = new Date().toISOString();
  persistBootstrapState();
}

function persistBootstrapState() {
  const payload = {
    ...bootstrapState,
    observedAt: bootstrapState.observedAt || new Date().toISOString(),
  };
  fs.writeFileSync(BOOTSTRAP_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function recordBootstrapStep(step, patch = {}) {
  Object.assign(bootstrapState, patch);
  bootstrapState.observedAt = new Date().toISOString();
  bootstrapState.steps.push({
    at: bootstrapState.observedAt,
    step,
    patch,
    pid: process.pid,
    surface: PROCESS_SURFACE,
  });
  persistBootstrapState();
}

function observeLifecycleMethod({
  bootstrapState,
  methodName,
  payload,
  processSurface,
  processPid,
  processPpid,
  traceId,
  now,
  recordBootstrapStep,
  writeLiveCsrfEvent,
}) {
  const timestamp = now || new Date().toISOString();
  if (!bootstrapState.hookInstalledAt) {
    bootstrapState.hookInstalledAt = timestamp;
  }
  if (!bootstrapState.firstInterceptedMethod) {
    bootstrapState.firstInterceptedMethod = methodName;
  }
  bootstrapState.processPid = processPid;
  bootstrapState.processPpid = processPpid;
  bootstrapState.processSurface = processSurface;
  if (!Array.isArray(bootstrapState.interceptedMethodsSample)) {
    bootstrapState.interceptedMethodsSample = [];
  }
  if (
    typeof methodName === "string"
    && !bootstrapState.interceptedMethodsSample.includes(methodName)
    && bootstrapState.interceptedMethodsSample.length < 20
  ) {
    bootstrapState.interceptedMethodsSample.push(methodName);
  }

  if (/languageServerStarted/i.test(methodName) && payload && typeof payload === "object") {
    const languageServerPort = typeof payload.languageServerPort === "number" ? payload.languageServerPort : null;
    const host = typeof payload.host === "string" ? payload.host : bootstrapState.host || "127.0.0.1";
    const patch = {
      host,
      languageServerPort,
      languageServerUrl: languageServerPort ? `http://${host}:${languageServerPort}` : bootstrapState.languageServerUrl,
      csrfToken: typeof payload.csrfToken === "string" ? payload.csrfToken : bootstrapState.csrfToken,
      languageServerStartedSeen: true,
      processPid,
      processPpid,
      processSurface,
      firstInterceptedMethod: bootstrapState.firstInterceptedMethod,
      interceptedMethodsSample: bootstrapState.interceptedMethodsSample.slice(),
    };
    recordBootstrapStep(`promiseClient.${methodName}`, patch);
    writeLiveCsrfEvent("languageServerStarted", {
      methodName,
      csrfToken: patch.csrfToken,
      languageServerPort,
      languageServerUrl: patch.languageServerUrl,
      traceId,
      origin: `promiseClient.${methodName}`,
      processPid,
      processPpid,
      processSurface,
      firstInterceptedMethod: bootstrapState.firstInterceptedMethod,
      interceptedMethodsSample: bootstrapState.interceptedMethodsSample.slice(),
      hookInstalledAt: bootstrapState.hookInstalledAt,
      observedAt: timestamp,
    });
  }
}

const traces = createTraceContext();
const reports = require("./windsurf-trace-report.cjs").createTraceReportBuilder();
const collectedTraceIds = new Set();
let nextTraceId = 1;
const activeTraces = new Map();

function detectProcessSurface(argv = process.argv) {
  const joined = argv.join(" ");
  if (/language_server_windows_x64\.exe/i.test(joined)) {
    return "language_server";
  }
  if (/devin\.exe\s+acp/i.test(joined)) {
    return "acp_agent";
  }
  if (/Windsurf\.exe/i.test(joined) || /extensionHostProcess/i.test(joined)) {
    return "host";
  }
  return "unknown";
}

const PROCESS_SURFACE = detectProcessSurface();
if (!bootstrapState.processSurface) {
  bootstrapState.processSurface = PROCESS_SURFACE;
}

function makeTraceId(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${nextTraceId++}`;
}

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/devin-session-token\$[A-Za-z0-9._-]+/g, "devin-session-token$...[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
      .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[redacted]"')
      .replace(/"access[_-]?token"\s*:\s*"[^"]+"/gi, '"accessToken":"[redacted]"');
  }
  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      length: value.length,
      utf8Preview: redact(value.toString("utf8").slice(0, 1200)),
      base64Preview: value.toString("base64").slice(0, 1200),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((entry) => redact(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/token|secret|authorization|cookie|api.?key/i.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redact(entry);
    }
    return out;
  }
  return value;
}

function writeEvent(type, payload) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    pid: process.pid,
    surface: PROCESS_SURFACE,
    type,
    payload: redact(payload),
  });
  fs.appendFileSync(LOG_PATH, `${line}\n`);
}

function classifyObservedKey(value) {
  if (typeof value !== "string" || value.length === 0) return "missing";
  if (value.startsWith("devin-session-token$")) return "devin_session_token";
  if (value.startsWith("ott$")) return "direct_cloud_key";
  if (value.startsWith("sk-ws-01-")) return "windsurf_api_key";
  return "unknown_candidate";
}

function previewSecretLikeValue(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  if (value.length <= 12) return `[len:${value.length}]`;
  return `${value.slice(0, 6)}…${value.slice(-4)}[len:${value.length}]`;
}

function summarizeStackFrames(stack, limit = 12) {
  if (typeof stack !== "string" || stack.length === 0) return [];
  return stack.split("\n").slice(1, limit + 1).map((line) => line.trim());
}

function captureOrigin(label, extra = {}) {
  const stack = captureStack();
  return {
    label,
    stack,
    stackFrames: summarizeStackFrames(stack),
    ...extra,
  };
}

function sanitizeAuthHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/authorization|api.?key|token|cookie/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function writeAuthEvent(event, payload = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: process.pid,
    surface: PROCESS_SURFACE,
    event,
    ...payload,
  });
  fs.appendFileSync(AUTH_LOG_PATH, `${line}\n`);
}

const authHydrationState = globalThis.__WINDSURF_AUTH_HYDRATION_STATE || {
  order: 0,
  providerRegisteredAt: null,
  initializeCachedSessionsStartedAt: null,
  initializeCachedSessionsCompletedAt: null,
  initializeCachedSessionsCompleted: false,
  initializeCachedSessionsSessionsLength: null,
  firstGetSessionAt: null,
  firstGetSessionOrder: null,
  firstGetSessionProviderId: null,
  firstGetSessionHadAccessToken: null,
};
globalThis.__WINDSURF_AUTH_HYDRATION_STATE = authHydrationState;

function nextAuthOrder() {
  authHydrationState.order += 1;
  return authHydrationState.order;
}

function computeAuthHydrationReady() {
  if (!authHydrationState.firstGetSessionAt) return null;
  return !!(
    authHydrationState.initializeCachedSessionsCompletedAt
    && authHydrationState.initializeCachedSessionsCompletedAt <= authHydrationState.firstGetSessionAt
  );
}

function emitAuthTimeline(event, payload = {}) {
  const order = nextAuthOrder();
  const timestamp = new Date().toISOString();
  writeAuthEvent(event, {
    order,
    authHydrationReady: computeAuthHydrationReady(),
    ...payload,
  });
  return { order, timestamp };
}

function writeLiveCsrfEvent(event, payload = {}) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: process.pid,
    surface: PROCESS_SURFACE,
    event,
    ...payload,
  });
  fs.appendFileSync(CSRF_LOG_PATH, `${line}\n`);
}

function safeOwnKeys(value) {
  try {
    return Reflect.ownKeys(value).map((key) => (typeof key === "symbol" ? key.toString() : String(key)));
  } catch (error) {
    return { error: error.message };
  }
}

function safePrototype(value) {
  try {
    const proto = Object.getPrototypeOf(value);
    if (!proto) return null;
    return {
      constructorName: proto.constructor && typeof proto.constructor === "function" ? proto.constructor.name : null,
      ownKeys: safeOwnKeys(proto),
    };
  } catch (error) {
    return { error: error.message };
  }
}

function summarizeDescriptorMap(value) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const out = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      const source = descriptors[key];
      const targetKey = typeof key === "symbol" ? key.toString() : String(key);
      out[targetKey] = {
        configurable: !!source.configurable,
        enumerable: !!source.enumerable,
        writable: "writable" in source ? !!source.writable : undefined,
        hasValue: "value" in source,
        valueType: "value" in source ? typeof source.value : undefined,
        getterType: typeof source.get,
        setterType: typeof source.set,
      };
    }
    return out;
  } catch (error) {
    return { error: error.message };
  }
}

function inspectFunction(fn) {
  if (typeof fn !== "function") {
    return { observed: false, type: typeof fn };
  }
  let source = null;
  let sourceError = null;
  try {
    source = Function.prototype.toString.call(fn);
  } catch (error) {
    sourceError = error.message;
  }
  return {
    observed: true,
    name: fn.name || null,
    length: fn.length,
    ownKeys: safeOwnKeys(fn),
    descriptors: summarizeDescriptorMap(fn),
    source,
    sourceError,
    isNativeSource: typeof source === "string" && source.includes("[native code]"),
    looksBound: typeof fn.name === "string" && fn.name.startsWith("bound "),
    prototypeType: typeof fn.prototype,
  };
}

function summarizeValue(value, depth = 0) {
  if (depth > 2) {
    return { type: typeof value, truncated: true };
  }
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "function") return inspectFunction(value);
  if (Buffer.isBuffer(value)) return redact(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => summarizeValue(entry, depth + 1));
  if (typeof value === "object") {
    const out = {
      type: value.constructor && typeof value.constructor === "function" ? value.constructor.name : "Object",
      ownKeys: safeOwnKeys(value),
      descriptors: summarizeDescriptorMap(value),
      preview: {},
    };
    for (const key of Object.keys(value).slice(0, 20)) {
      try {
        out.preview[key] = summarizeValue(value[key], depth + 1);
      } catch (error) {
        out.preview[key] = { error: error.message };
      }
    }
    return out;
  }
  return { type: typeof value };
}

function inspectProvider(provider) {
  const methodNames = [
    "provideLanguageModelChatResponse",
    "provideLanguageModelChatInformation",
    "provideTokenCount",
  ];
  const methods = {};
  for (const methodName of methodNames) {
    let value;
    let getError = null;
    try {
      value = Reflect.get(provider, methodName, provider);
    } catch (error) {
      getError = error.message;
    }
    methods[methodName] = {
      getError,
      function: inspectFunction(value),
    };
  }
  return {
    typeof: typeof provider,
    constructorName: provider && provider.constructor && typeof provider.constructor === "function"
      ? provider.constructor.name
      : null,
    ownKeys: safeOwnKeys(provider),
    descriptors: summarizeDescriptorMap(provider),
    prototype: safePrototype(provider),
    extensible: provider && typeof provider === "object" ? Object.isExtensible(provider) : null,
    sealed: provider && typeof provider === "object" ? Object.isSealed(provider) : null,
    frozen: provider && typeof provider === "object" ? Object.isFrozen(provider) : null,
    methods,
    proxyDetection: {
      revocablePattern: "NOT OBSERVED",
      accessTrapsViaReflectGet: methodNames.map((methodName) => {
        try {
          Reflect.get(provider, methodName, provider);
          return { methodName, observed: true };
        } catch (error) {
          return { methodName, observed: false, error: error.message };
        }
      }),
    },
  };
}

function captureStack() {
  return new Error().stack || null;
}

function createTrace(kind, payload) {
  const traceId = makeTraceId(kind);
  const trace = {
    traceId,
    kind,
    startedAt: Date.now(),
    firstAsyncBoundaryAt: null,
    payload,
  };
  activeTraces.set(traceId, trace);
  writeEvent("trace-start", trace);
  return trace;
}

function markFirstAsyncBoundary(trace, label) {
  if (!trace || trace.firstAsyncBoundaryAt !== null) return;
  trace.firstAsyncBoundaryAt = Date.now();
  writeEvent("trace-first-async-boundary", {
    traceId: trace.traceId,
    label,
    deltaMs: trace.firstAsyncBoundaryAt - trace.startedAt,
  });
}

function finishTrace(trace, extra) {
  if (!trace) return;
  const finishedAt = Date.now();
  writeEvent("trace-finish", {
    traceId: trace.traceId,
    durationMs: finishedAt - trace.startedAt,
    firstAsyncBoundaryDeltaMs: trace.firstAsyncBoundaryAt === null ? null : trace.firstAsyncBoundaryAt - trace.startedAt,
    ...extra,
  });
  activeTraces.delete(trace.traceId);
}

writeEvent("hook-loaded", {
  argv: process.argv,
  cwd: process.cwd(),
  entry: process.argv[1] || null,
  stateDbExists: fs.existsSync(STATE_DB),
  bootstrapPath: BOOTSTRAP_PATH,
});
persistBootstrapState();
wrapRandomUUID();

process.on("exit", () => {
  const traceIds = Array.from(collectedTraceIds);
  const summary = {
    generatedAt: new Date().toISOString(),
    traceCount: traceIds.length,
    traces: traceIds.map((traceId) => reports.buildTraceReport(traceId)),
    metrics: reports.buildMetrics(traceIds),
  };
  fs.writeFileSync(path.join(ROOT, "windsurf-model-runtime-report.json"), JSON.stringify(summary, null, 2));
});

function previewArgs(args) {
  return args.map((arg) => summarizeValue(arg));
}

function summarizeMetadataRecord(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const [key, raw] of Object.entries(value).slice(0, 40)) {
    if (raw === null || raw === undefined) {
      out[key] = raw;
      continue;
    }
    if (Array.isArray(raw)) {
      out[key] = raw.slice(0, 10).map((entry) => summarizeValue(entry));
      continue;
    }
    out[key] = summarizeValue(raw);
  }
  return out;
}

function extractRpcMethodDescriptor(value, prop) {
  const descriptor = {
    clientProperty: String(prop),
    serviceTypeName: null,
    serviceMethodName: null,
    serviceMethodKind: null,
    requestTypeName: null,
    responseTypeName: null,
    path: null,
  };
  if (!value || typeof value !== "function") return descriptor;

  const method = value.method && typeof value.method === "object" ? value.method : null;
  const service = method?.parent && typeof method.parent === "object" ? method.parent : null;
  descriptor.serviceTypeName = typeof service?.typeName === "string" ? service.typeName : null;
  descriptor.serviceMethodName = typeof method?.name === "string" ? method.name : null;
  descriptor.serviceMethodKind = typeof method?.kind === "string" || typeof method?.kind === "number" ? method.kind : null;
  descriptor.requestTypeName = typeof method?.I?.typeName === "string" ? method.I.typeName : null;
  descriptor.responseTypeName = typeof method?.O?.typeName === "string" ? method.O.typeName : null;
  if (descriptor.serviceTypeName && descriptor.serviceMethodName) {
    descriptor.path = `/${descriptor.serviceTypeName}/${descriptor.serviceMethodName}`;
  }
  return descriptor;
}

function summarizeConnectCallOptions(value) {
  if (!value || typeof value !== "object") return summarizeValue(value);
  return {
    timeoutMs: typeof value.timeoutMs === "number" ? value.timeoutMs : null,
    signalAborted: !!value.signal?.aborted,
    metadata: summarizeMetadataRecord(value.metadata),
    headers: summarizeMetadataRecord(value.headers),
    contextValues: summarizeValue(value.contextValues),
  };
}

function summarizeIpcArgs(args) {
  return args.slice(0, 4).map((arg) => summarizeValue(arg));
}

function instrumentWebContentsForDebug(webContents, origin) {
  if (!WINDSURF_DEBUG_ELECTRON || !webContents || webContents.__windsurfElectronDebugHooked) return;
  webContents.__windsurfElectronDebugHooked = true;

  writeEvent("electron-debug-webcontents-instrumented", {
    origin,
    id: webContents.id ?? null,
    url: typeof webContents.getURL === "function" ? webContents.getURL() : null,
  });

  if (typeof webContents.openDevTools === "function") {
    const originalOpenDevTools = webContents.openDevTools.bind(webContents);
    const ensureDevTools = () => {
      try {
        originalOpenDevTools({ mode: "detach" });
        writeEvent("electron-debug-open-devtools", {
          origin,
          id: webContents.id ?? null,
        });
      } catch (error) {
        writeEvent("hook-error", { phase: "electronDebug.openDevTools", message: error.message });
      }
    };

    if (typeof webContents.once === "function") {
      webContents.once("dom-ready", ensureDevTools);
    } else {
      ensureDevTools();
    }
  }

  if (typeof webContents.send === "function" && !webContents.send.__windsurfElectronDebugHooked) {
    const originalSend = webContents.send;
    webContents.send = function patchedWebContentsSend(channel, ...args) {
      writeEvent("electron-ipc-main-to-renderer", {
        origin,
        id: this.id ?? null,
        channel,
        args: summarizeIpcArgs(args),
      });
      return originalSend.call(this, channel, ...args);
    };
    webContents.send.__windsurfElectronDebugHooked = true;
  }

  if (typeof webContents.on === "function") {
    webContents.on("console-message", (_event, level, message, line, sourceId) => {
      writeEvent("electron-renderer-console-message", {
        origin,
        id: webContents.id ?? null,
        level,
        message,
        line,
        sourceId,
      });
    });
  }
}

async function enableElectronDebugRuntime() {
  if (!WINDSURF_DEBUG_ELECTRON) return;

  try {
    const electron = require("electron");
    if (!electron || !electron.app) return;

    const { app, BrowserWindow, ipcMain, webContents } = electron;
    if (app.__windsurfElectronDebugInitialized) return;
    app.__windsurfElectronDebugInitialized = true;

    writeEvent("electron-debug-init", {
      packagePath: ELECTRON_DEBUG_PACKAGE,
      pid: process.pid,
      argv: process.argv,
    });

    const electronDebugModule = await import(`file://${ELECTRON_DEBUG_PACKAGE}`);
    const activateElectronDebug = electronDebugModule.default;
    if (typeof activateElectronDebug === "function") {
      activateElectronDebug({
        isEnabled: true,
        showDevTools: true,
        devToolsMode: "detach",
      });
      writeEvent("electron-debug-activated", { packagePath: ELECTRON_DEBUG_PACKAGE });
    }

    const instrumentWindow = (win, origin) => {
      if (!win) return;
      instrumentWebContentsForDebug(win.webContents, origin);
    };

    if (BrowserWindow && typeof BrowserWindow.getAllWindows === "function") {
      for (const win of BrowserWindow.getAllWindows()) {
        instrumentWindow(win, "existing-window");
      }
    }

    app.on("browser-window-created", (_event, win) => {
      instrumentWindow(win, "browser-window-created");
    });

    if (webContents && typeof webContents.on === "function") {
      webContents.on("created", (_event, contents) => {
        instrumentWebContentsForDebug(contents, "webcontents-created");
      });
    }

    if (ipcMain && typeof ipcMain.on === "function" && !ipcMain.on.__windsurfElectronDebugHooked) {
      const originalOn = ipcMain.on;
      ipcMain.on = function patchedIpcMainOn(channel, listener) {
        return originalOn.call(this, channel, function wrappedIpcMainListener(event, ...args) {
          writeEvent("electron-ipc-renderer-to-main", {
            channel,
            kind: "on",
            senderId: event?.sender?.id ?? null,
            args: summarizeIpcArgs(args),
          });
          return listener.call(this, event, ...args);
        });
      };
      ipcMain.on.__windsurfElectronDebugHooked = true;
    }

    if (ipcMain && typeof ipcMain.handle === "function" && !ipcMain.handle.__windsurfElectronDebugHooked) {
      const originalHandle = ipcMain.handle;
      ipcMain.handle = function patchedIpcMainHandle(channel, listener) {
        return originalHandle.call(this, channel, async function wrappedIpcMainHandle(event, ...args) {
          writeEvent("electron-ipc-renderer-to-main", {
            channel,
            kind: "handle",
            senderId: event?.sender?.id ?? null,
            args: summarizeIpcArgs(args),
          });
          return listener.call(this, event, ...args);
        });
      };
      ipcMain.handle.__windsurfElectronDebugHooked = true;
    }
  } catch (error) {
    writeEvent("hook-error", { phase: "enableElectronDebugRuntime", message: error.message });
  }
}

enableElectronDebugRuntime().catch((error) => {
  writeEvent("hook-error", { phase: "enableElectronDebugRuntime.catch", message: error.message });
});

function wrapRandomUUID() {
  try {
    const crypto = require("node:crypto");
    if (typeof crypto.randomUUID !== "function" || crypto.randomUUID.__windsurfHooked) return;
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = function patchedRandomUUID(...args) {
      const value = originalRandomUUID.apply(this, args);
      writeEvent("crypto-randomUUID", {
        value,
        args: previewArgs(args),
        stack: captureStack(),
      });
      recordBootstrapStep("crypto.randomUUID", {
        csrfToken: value,
      });
      return value;
    };
    crypto.randomUUID.__windsurfHooked = true;
  } catch (error) {
    writeEvent("hook-error", { phase: "wrapRandomUUID", message: error.message });
  }
}

function extractSpawnSnapshot(methodName, args) {
  if (!Array.isArray(args) || args.length === 0) return null;
  const command = typeof args[0] === "string" ? args[0] : null;
  const commandArgs = Array.isArray(args[1]) ? args[1] : [];
  const options = args.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (Object.prototype.hasOwnProperty.call(entry, "env") || Object.prototype.hasOwnProperty.call(entry, "cwd"))) || null;

  if (!command || !/(language_server_windows_(x64|arm)\.exe|Windsurf\.exe)$/i.test(command)) {
    return null;
  }

  const env = options && options.env && typeof options.env === "object" ? options.env : {};
  return {
    methodName,
    command,
    commandArgs,
    cwd: options && typeof options.cwd === "string" ? options.cwd : null,
    envSnapshot: {
      NODE_OPTIONS: typeof env.NODE_OPTIONS === "string" ? env.NODE_OPTIONS : null,
      VSCODE_NODE_OPTIONS: typeof env.VSCODE_NODE_OPTIONS === "string" ? env.VSCODE_NODE_OPTIONS : null,
      ELECTRON_RUN_AS_NODE: typeof env.ELECTRON_RUN_AS_NODE === "string" ? env.ELECTRON_RUN_AS_NODE : null,
      WINDSURF_CSRF_TOKEN: typeof env.WINDSURF_CSRF_TOKEN === "string" ? env.WINDSURF_CSRF_TOKEN : null,
      CODEIUM_EDITOR_APP_ROOT: typeof env.CODEIUM_EDITOR_APP_ROOT === "string" ? env.CODEIUM_EDITOR_APP_ROOT : null,
      HTTP_PROXY: typeof env.HTTP_PROXY === "string" ? env.HTTP_PROXY : null,
      HTTPS_PROXY: typeof env.HTTPS_PROXY === "string" ? env.HTTPS_PROXY : null,
    },
  };
}

function extractPayloadKeys(value) {
  if (!value || typeof value !== "object") return [];
  try {
    return Object.keys(value).slice(0, 40);
  } catch {
    return [];
  }
}

function classifyProviderSource(vendor) {
  if (typeof vendor !== "string") return TRACE_NOT_OBSERVED;
  if (/devin|summary/i.test(vendor)) return "acp_cloud";
  if (/windsurf|codeium/i.test(vendor)) return "local_host";
  return TRACE_NOT_OBSERVED;
}

function parseJsonLikeMessage(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inferEvidenceClass(type, payload = {}) {
  if (payload.evidenceClass) return payload.evidenceClass;
  if (type === "provider-binding") return "provider_binding";
  if (type === "acp-outbound") return "acp_outbound";
  if (type === "ls-outbound") return "ls_outbound";
  if (type === "http-response") {
    return payload.isInferenceEndpoint ? "inference_response" : "ls_outbound";
  }
  if (type === "http-request") {
    return payload.isInferenceEndpoint ? "inference_request" : "ls_outbound";
  }
  return "registration";
}

function normalizeTraceEnvelope(type, payload = {}) {
  const traceId = payload.traceId || traces.getActiveTraceId();
  const timestamp = payload.timestamp || new Date().toISOString();
  const normalized = {
    ...payload,
    traceId,
    timestamp,
    surface: payload.surface || PROCESS_SURFACE,
    evidenceClass: inferEvidenceClass(type, payload),
    target: payload.target || payload.url || payload.endpoint || payload.destination || TRACE_NOT_OBSERVED,
  };

  if (Array.isArray(normalized.args)) {
    normalized.args = previewArgs(normalized.args);
  }

  return normalized;
}

function isInferenceTarget(target) {
  return typeof target === "string" && /\/(messages|chat\/completions|completions)(\?|$)/i.test(target);
}

function captureCurrentTrace() {
  const traceList = Array.from(activeTraces.values());
  return traceList.length > 0 ? traceList[traceList.length - 1] : null;
}

function createProviderWrapper({ vendor, provider, traces, writeEvent }) {
  const wrapped = Object.create(Object.getPrototypeOf(provider) || Object.prototype);
  Object.assign(wrapped, provider);

  for (const methodName of [
    "provideLanguageModelChatResponse",
    "provideLanguageModelChatInformation",
    "provideTokenCount",
  ]) {
    const original = provider[methodName];
    if (typeof original !== "function") continue;
    wrapped[methodName] = async (...args) => {
      const started = traces.startProviderTrace({
        vendor,
        method: methodName,
        observedArgs: args,
      });
      const providerBindingEvent = normalizeTraceEnvelope("provider-binding", {
        traceId: started.traceId,
        vendor,
        providerSource: classifyProviderSource(vendor),
        providerMethod: methodName,
        modelHint: typeof args[0]?.model === "string"
          ? args[0].model
          : typeof args[0]?.modelId === "string"
            ? args[0].modelId
            : TRACE_NOT_OBSERVED,
        payloadKeys: extractPayloadKeys(args[0]),
        stack: new Error().stack || null,
      });
      writeEvent("provider-binding", providerBindingEvent);
      reports.recordProviderEntry({
        trace_id: started.traceId,
        method: methodName,
        evidence_class: providerBindingEvent.evidenceClass,
        provider_source: providerBindingEvent.providerSource,
        target: providerBindingEvent.target,
        timestamp: providerBindingEvent.timestamp,
      });
      writeEvent("lm-provider-method-call", {
        traceId: started.traceId,
        vendor,
        methodName,
        args,
        stack: new Error().stack || null,
      });
      return traces.runWithTrace(started.traceId, async () => {
        try {
          const result = await Promise.resolve(original.apply(provider, args));
          writeEvent("lm-provider-method-result", {
            traceId: started.traceId,
            vendor,
            methodName,
            status: "resolved",
          });
          return result;
        } catch (error) {
          writeEvent("lm-provider-method-result", {
            traceId: started.traceId,
            vendor,
            methodName,
            status: "rejected",
            error: { message: error.message },
          });
          throw error;
        }
      });
    };
  }

  return wrapped;
}

function createRpcWrapper({ target, traces, writeEvent }) {
  return new Proxy(target, {
    get(originalTarget, prop, receiver) {
      const value = Reflect.get(originalTarget, prop, receiver);
      if (typeof value !== "function") return value;
      if (!String(prop).startsWith("$try") && !String(prop).startsWith("$start")) return value;
      return async function wrappedRpcMethod(...args) {
        const activeTraceId = traces.getActiveTraceId();
        const callId = typeof args[0] === "string" ? args[0] : null;
        if (callId && activeTraceId !== TRACE_NOT_OBSERVED) {
          traces.bindRpcCall(callId, activeTraceId);
        }
        if (args[1] && typeof args[1] === "object") {
          const metadata =
            args[1].metadata && typeof args[1].metadata === "object" ? args[1].metadata : {};
          args[1] = { ...args[1], metadata: { ...metadata, trace_id: activeTraceId } };
        }
        writeEvent("rpc-call", {
          traceId: activeTraceId,
          methodName: String(prop),
          callId,
        });
        return value.apply(originalTarget, args);
      };
    },
  });
}

function isChatRpcMethodName(methodName) {
  return /getChatMessage|rawGetChatMessage/i.test(methodName);
}

function cloneJsonSafe(value, seen = new WeakMap()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") {
    return {
      __type: "function",
      name: value.name || null,
    };
  }
  if (Buffer.isBuffer(value)) {
    return {
      __type: "buffer",
      utf8: value.toString("utf8"),
      base64: value.toString("base64"),
      length: value.length,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonSafe(entry, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return {
        __type: "circular",
        ref: seen.get(value),
      };
    }
    const ref = `ref_${seen.size + 1}`;
    seen.set(value, ref);

    const out = {};
    for (const key of safeOwnKeys(value)) {
      try {
        out[key] = cloneJsonSafe(value[key], seen);
      } catch (error) {
        out[key] = { __error: error.message };
      }
    }

    const ctorName = value.constructor && typeof value.constructor === "function" ? value.constructor.name : null;
    if (ctorName && ctorName !== "Object") {
      out.__type = ctorName;
    }
    return out;
  }
  return String(value);
}

function captureChatConstructorPayload(type, payload) {
  const captured = {
    type,
    payload: cloneJsonSafe(payload),
    capturedAt: new Date().toISOString(),
    pid: process.pid,
    surface: PROCESS_SURFACE,
  };
  globalThis.WINDSURF_LAST_REQUEST = captured;
  const history = Array.isArray(globalThis.WINDSURF_REQUEST_HISTORY)
    ? globalThis.WINDSURF_REQUEST_HISTORY
    : [];
  history.push(captured);
  globalThis.WINDSURF_REQUEST_HISTORY = history.slice(-10);
  writeEvent("chat-request-constructor", captured);
  try {
    console.log(JSON.stringify({
      __windsurfChatRequestCapture: true,
      ...captured,
    }, null, 2));
  } catch (error) {
    writeEvent("hook-error", {
      phase: "captureChatConstructorPayload",
      message: error.message,
      type,
    });
  }
}

function summarizeChatRequestPayload(value) {
  if (!value || typeof value !== "object") return summarizeValue(value);
  const firstMessage = Array.isArray(value.chatMessages) ? value.chatMessages[0] : undefined;
  return {
    typeName: typeof value.getType === "function" ? value.getType()?.typeName || null : value.constructor?.typeName || null,
    constructorName: value.constructor?.name || null,
    ownKeys: safeOwnKeys(value),
    chatMessagesCount: Array.isArray(value.chatMessages) ? value.chatMessages.length : null,
    firstMessage: firstMessage
      ? {
          ownKeys: safeOwnKeys(firstMessage),
          role: firstMessage.role ?? firstMessage.source ?? null,
          contentPreview: typeof firstMessage.content === "string"
            ? firstMessage.content.slice(0, 500)
            : summarizeValue(firstMessage.content),
        }
      : null,
    chatModel: value.chatModel ?? null,
    chatModelName: value.chatModelName ?? null,
    systemPromptOverride: typeof value.systemPromptOverride === "string"
      ? value.systemPromptOverride.slice(0, 500)
      : summarizeValue(value.systemPromptOverride),
    metadata: summarizeValue(value.metadata),
    activeDocument: summarizeValue(value.activeDocument),
    workspaceUris: Array.isArray(value.workspaceUris) ? value.workspaceUris.slice(0, 20) : null,
  };
}

function hookChatRequestClass(candidate) {
  if (typeof candidate !== "function" || candidate.__windsurfChatRequestClassHooked) return candidate;
  const typeName = typeof candidate.typeName === "string" ? candidate.typeName : null;
  if (!/exa\.chat_pb\.(GetChatMessageRequest|RawGetChatMessageRequest)/.test(typeName || "")) {
    return candidate;
  }

  const Wrapped = class extends candidate {
    constructor(payload, ...rest) {
      captureChatConstructorPayload(typeName.split(".").pop(), payload);
      super(payload, ...rest);
    }
  };

  try {
    Object.defineProperty(Wrapped, "name", { value: candidate.name, configurable: true });
  } catch {}
  for (const key of Reflect.ownKeys(candidate)) {
    if (key === "prototype" || key === "name" || key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(Wrapped, key, descriptor);
    } catch {}
  }
  Wrapped.__windsurfChatRequestClassHooked = true;
  candidate.__windsurfChatRequestClassHooked = true;
  writeEvent("chat-request-class-hook-installed", {
    typeName,
    className: candidate.name || null,
  });
  return Wrapped;
}

function wrapPromiseClient(client) {
  if (!client || typeof client !== "object" || client.__windsurfHookedPromiseClient) return client;
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return function wrappedClientMethod(...args) {
        const methodName = String(prop);
        const rpc = extractRpcMethodDescriptor(value, prop);
        const trace = captureCurrentTrace();
        const traceId = trace?.traceId || traces.getActiveTraceId();
        const payload = args[0];
        const callOptions = args[1] && typeof args[1] === "object" ? args[1] : null;
        observeLifecycleMethod({
          bootstrapState,
          methodName,
          payload,
          processSurface: PROCESS_SURFACE,
          processPid: process.pid,
          processPpid: typeof process.ppid === "number" ? process.ppid : null,
          traceId,
          recordBootstrapStep,
          writeLiveCsrfEvent,
        });
        if (rpc.path && /LanguageServerService/i.test(rpc.serviceTypeName || "")) {
          const patch = {};
          if (bootstrapState.languageServerUrl) {
            patch.languageServerUrl = bootstrapState.languageServerUrl;
          }
          patch.lastRpcPath = rpc.path;
          patch.lastRpcMethodName = rpc.serviceMethodName;
          patch.lastRpcRequestType = rpc.requestTypeName;
          recordBootstrapStep(`promiseClient.${methodName}.rpc`, patch);
          if (/StartCascade|SendUserCascadeMessage|InitializeCascadePanelState|GetUnleashData/i.test(rpc.serviceMethodName || "")) {
            writeLiveCsrfEvent("LanguageServerRpcCall", {
              traceId,
              methodName,
              rpc,
              metadata: summarizeMetadataRecord(callOptions?.metadata),
              headers: summarizeMetadataRecord(callOptions?.headers),
              payload: summarizeValue(payload),
              origin: `promiseClient.${methodName}`,
            });
          }
        }
        writeEvent("promise-client-call", {
          traceId,
          methodName,
          rpc,
          isChatMethod: isChatRpcMethodName(methodName),
          payload: isChatRpcMethodName(methodName)
            ? summarizeChatRequestPayload(payload)
            : summarizeValue(payload),
          options: summarizeConnectCallOptions(callOptions),
          stack: captureStack(),
        });
        const result = value.apply(target, args);
        if (result && typeof result.then === "function") {
          return result.then((resolved) => {
            writeEvent("promise-client-result", {
              traceId,
              methodName,
              rpc,
              status: "resolved",
              resolved: summarizeValue(resolved),
            });
            return resolved;
          }, (error) => {
            writeEvent("promise-client-result", {
              traceId,
              methodName,
              rpc,
              status: "rejected",
              error: { message: error.message },
            });
            throw error;
          });
        }
        writeEvent("promise-client-result", {
          traceId,
          methodName,
          rpc,
          status: "returned",
          resolved: summarizeValue(result),
        });
        return result;
      };
    },
  });
  Object.defineProperty(proxy, "__windsurfHookedPromiseClient", { value: true });
  return proxy;
}

function emitTransportEvent(type, payload) {
  const event = normalizeTraceEnvelope(type, payload);
  writeEvent(type, event);
  if (event.traceId !== TRACE_NOT_OBSERVED) {
    collectedTraceIds.add(event.traceId);
    reports.recordTransportEvent({
      trace_id: event.traceId,
      type: payload.transportType || type,
      target: event.target,
      timestamp: event.timestamp,
      evidence_class: event.evidenceClass,
      surface: event.surface,
    });
  }
}

function wrapFetch() {
  if (typeof globalThis.fetch !== "function" || globalThis.fetch.__windsurfHooked) return;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function patchedFetch(...args) {
    const trace = captureCurrentTrace();
    markFirstAsyncBoundary(trace, "fetch");
    const request = args[0];
    const init = args[1] && typeof args[1] === "object" ? args[1] : {};
    const url = typeof request === "string"
      ? request
      : request && typeof request.url === "string"
        ? request.url
        : null;
    const headers = request && typeof request.headers === "object"
      ? Object.fromEntries(typeof request.headers.entries === "function" ? request.headers.entries() : Object.entries(request.headers))
      : init.headers && typeof init.headers === "object"
        ? Object.fromEntries(typeof init.headers.entries === "function" ? init.headers.entries() : Object.entries(init.headers))
        : {};
    const rpcMatch = typeof url === "string"
      ? url.match(/\/([^/]+(?:\.[^/]+)*)\/([^/?#]+)$/)
      : null;
    const rpc = rpcMatch
      ? {
          serviceTypeName: rpcMatch[1] || null,
          serviceMethodName: rpcMatch[2] || null,
          path: `/${rpcMatch[1]}/${rpcMatch[2]}`,
        }
      : null;
    emitTransportEvent("fetch-call", {
      traceId: trace?.traceId || traces.getActiveTraceId(),
      transportType: "FETCH",
      args: previewArgs(args),
      url,
      rpc,
      stack: captureStack(),
    });
    writeAuthEvent("outgoing_request", {
      url,
      auth_headers: sanitizeAuthHeaders(headers),
      traceId: trace?.traceId || traces.getActiveTraceId(),
    });
    if (rpc?.serviceTypeName === "exa.language_server_pb.LanguageServerService") {
      recordBootstrapStep(`fetch.${rpc.serviceMethodName || "unknown"}`, {
        lastRpcPath: rpc.path,
        lastRpcMethodName: rpc.serviceMethodName || null,
      });
      if (/StartCascade|SendUserCascadeMessage|InitializeCascadePanelState|GetUnleashData/i.test(rpc.serviceMethodName || "")) {
        writeLiveCsrfEvent("LanguageServerFetchRequest", {
          url,
          rpc,
          headerKey: Object.keys(headers).find((key) => key.toLowerCase() === "x-codeium-csrf-token") || null,
          csrfToken: headers["x-codeium-csrf-token"] || headers["X-Codeium-Csrf-Token"] || null,
          cookies: headers.cookie || headers.Cookie || null,
          metadataApiKey: headers["x-api-key"] || headers["X-Api-Key"] || null,
          headers: summarizeMetadataRecord(headers),
          traceId: trace?.traceId || traces.getActiveTraceId(),
          origin: "fetch",
        });
      }
    }
    const result = await originalFetch.apply(this, args);
    writeEvent("fetch-result", {
      traceId: trace?.traceId || traces.getActiveTraceId(),
      rpc,
      status: result?.status,
      ok: result?.ok,
      url: result?.url || null,
    });
    return result;
  };
  globalThis.fetch.__windsurfHooked = true;
}

function wrapWebSocket() {
  if (typeof globalThis.WebSocket !== "function" || globalThis.WebSocket.__windsurfHooked) return;
  const OriginalWebSocket = globalThis.WebSocket;
  function PatchedWebSocket(...args) {
    const trace = captureCurrentTrace();
    markFirstAsyncBoundary(trace, "WebSocket");
    const socket = Reflect.construct(OriginalWebSocket, args, new.target || PatchedWebSocket);
    emitTransportEvent("websocket-construct", {
      traceId: trace?.traceId || traces.getActiveTraceId(),
      transportType: "WS",
      target: typeof args[0] === "string" ? args[0] : TRACE_NOT_OBSERVED,
      args: previewArgs(args),
      stack: captureStack(),
    });
    if (socket && typeof socket.send === "function" && !socket.send.__windsurfHooked) {
      const originalSend = socket.send;
      socket.send = function patchedWebSocketSend(message, ...rest) {
        const activeTraceId = traces.getActiveTraceId();
        const parsed = parseJsonLikeMessage(typeof message === "string" ? message : null);
        const payloadKeys = extractPayloadKeys(parsed);
        const eventName = PROCESS_SURFACE === "acp_agent" ? "acp-outbound" : "websocket-send";
        const outboundEvent = normalizeTraceEnvelope(eventName, {
          traceId: activeTraceId,
          target: typeof args[0] === "string" ? args[0] : TRACE_NOT_OBSERVED,
          payloadKeys,
          messageKind: parsed && typeof parsed === "object" && typeof parsed.method === "string"
            ? parsed.method
            : TRACE_NOT_OBSERVED,
          rawPreview: typeof message === "string" ? message.slice(0, 400) : summarizeValue(message),
        });
        writeEvent(eventName, outboundEvent);
        if (eventName === "acp-outbound" && outboundEvent.traceId !== TRACE_NOT_OBSERVED) {
          collectedTraceIds.add(outboundEvent.traceId);
          reports.recordTransportEvent({
            trace_id: outboundEvent.traceId,
            type: "WS_OUTBOUND",
            target: outboundEvent.target,
            timestamp: outboundEvent.timestamp,
            evidence_class: outboundEvent.evidenceClass,
            surface: outboundEvent.surface,
          });
        }
        return originalSend.call(this, message, ...rest);
      };
      socket.send.__windsurfHooked = true;
    }
    return socket;
  }
  Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  PatchedWebSocket.__windsurfHooked = true;
  globalThis.WebSocket = PatchedWebSocket;
}

function wrapRequest(mod, protocol) {
  const originalRequest = mod.request;
  mod.request = function patchedRequest(...args) {
    const trace = captureCurrentTrace();
    try {
      const options = args[0] && typeof args[0] === "object" ? args[0] : args[1] && typeof args[1] === "object" ? args[1] : null;
      const target = typeof args[0] === "string"
        ? args[0]
        : options
          ? `${protocol}//${options.hostname || options.host || ""}${options.path || ""}`
          : null;
      const inferenceTarget = isInferenceTarget(target);
      const authHeaders = options && typeof options.headers === "object" ? sanitizeAuthHeaders(options.headers) : {};
      markFirstAsyncBoundary(trace, `${protocol}request`);
      const activeTraceId = trace?.traceId || traces.getActiveTraceId();
      emitTransportEvent("http-request", {
        traceId: activeTraceId,
        transportType: inferenceTarget ? "HTTP_INFERENCE_REQUEST" : "HTTP",
        protocol,
        target,
        args: args.slice(0, 2),
        stack: captureStack(),
        isInferenceEndpoint: inferenceTarget,
      });
      writeAuthEvent("outgoing_request", {
        url: target,
        auth_headers: authHeaders,
        traceId: activeTraceId,
      });
      if (PROCESS_SURFACE === "language_server") {
        const lsOutboundEvent = normalizeTraceEnvelope("ls-outbound", {
          traceId: activeTraceId,
          transport: "http",
          protocol,
          endpoint: target || TRACE_NOT_OBSERVED,
          target: target || TRACE_NOT_OBSERVED,
          payloadKeys: extractPayloadKeys(args[0]),
          isInferenceEndpoint: inferenceTarget,
          evidenceClass: inferenceTarget ? "inference_request" : "ls_outbound",
        });
        writeEvent("ls-outbound", lsOutboundEvent);
        if (lsOutboundEvent.traceId !== TRACE_NOT_OBSERVED) {
          collectedTraceIds.add(lsOutboundEvent.traceId);
          reports.recordTransportEvent({
            trace_id: lsOutboundEvent.traceId,
            type: inferenceTarget ? "HTTP_INFERENCE_REQUEST" : "LS_OUTBOUND",
            target: lsOutboundEvent.target,
            timestamp: lsOutboundEvent.timestamp,
            evidence_class: lsOutboundEvent.evidenceClass,
            surface: lsOutboundEvent.surface,
          });
        }
      }
    } catch (error) {
      writeEvent("hook-error", { phase: "request", protocol, message: error.message });
    }
    const req = originalRequest.apply(this, args);
    req.on("response", (res) => {
      const chunks = [];
      const capture = /model|cascade|command|chat|status|auth|seat|api_server|language_server/i.test(String(res.req?.path || "")) || /model|cascade|command|chat|status|auth|seat/i.test(String(res.headers[":path"] || ""));
      if (!capture) return;
      res.on("data", (chunk) => {
        if (chunks.reduce((n, b) => n + b.length, 0) < 2_000_000) chunks.push(Buffer.from(chunk));
      });
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const responseTarget = typeof res.req?.path === "string"
          ? `${protocol}//${res.req?.host || ""}${res.req.path}`
          : null;
        const inferenceTarget = isInferenceTarget(responseTarget);
        const responseEvent = normalizeTraceEnvelope("http-response", {
          traceId: trace?.traceId || traces.getActiveTraceId(),
          protocol,
          statusCode: res.statusCode,
          headers: res.headers,
          path: res.req?.path || null,
          body,
          target: responseTarget,
          isInferenceEndpoint: inferenceTarget,
          evidenceClass: inferenceTarget ? "inference_response" : "ls_outbound",
        });
        writeEvent("http-response", responseEvent);
        if (responseEvent.traceId !== TRACE_NOT_OBSERVED) {
          collectedTraceIds.add(responseEvent.traceId);
          reports.recordTransportEvent({
            trace_id: responseEvent.traceId,
            type: inferenceTarget ? "HTTP_INFERENCE_RESPONSE" : "HTTP_RESPONSE",
            target: responseEvent.target,
            timestamp: responseEvent.timestamp,
            evidence_class: responseEvent.evidenceClass,
            surface: responseEvent.surface,
          });
        }
      });
    });
    return req;
  };
}

wrapFetch();
wrapWebSocket();
wrapRequest(http, "http:");
wrapRequest(https, "https:");

if (net.Socket && net.Socket.prototype && !net.Socket.prototype.connect.__windsurfHooked) {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patchedConnect(...args) {
    const trace = captureCurrentTrace();
    markFirstAsyncBoundary(trace, "net.Socket.connect");
    emitTransportEvent("net-connect", {
      traceId: trace?.traceId || traces.getActiveTraceId(),
      transportType: "IPC",
      destination: previewArgs(args)[0] || TRACE_NOT_OBSERVED,
      args: previewArgs(args),
      stack: captureStack(),
    });
    return originalConnect.apply(this, args);
  };
  net.Socket.prototype.connect.__windsurfHooked = true;
}

for (const methodName of ["spawn", "exec", "execFile", "fork"]) {
  if (typeof childProcess[methodName] === "function" && !childProcess[methodName].__windsurfHooked) {
    const originalMethod = childProcess[methodName];
    childProcess[methodName] = function patchedChildProcess(...args) {
      const trace = captureCurrentTrace();
      markFirstAsyncBoundary(trace, `child_process.${methodName}`);
      const spawnSnapshot = extractSpawnSnapshot(methodName, args);
      emitTransportEvent("child-process-call", {
        traceId: trace?.traceId || traces.getActiveTraceId(),
        transportType: "PROCESS",
        destination: typeof args[0] === "string" ? args[0] : TRACE_NOT_OBSERVED,
        methodName,
        args: previewArgs(args),
        spawnSnapshot,
        stack: captureStack(),
      });
      return originalMethod.apply(this, args);
    };
    childProcess[methodName].__windsurfHooked = true;
  }
}

if (typeof process.send === "function" && !process.send.__windsurfHooked) {
  const originalProcessSend = process.send;
  process.send = function patchedProcessSend(...args) {
    const trace = captureCurrentTrace();
    markFirstAsyncBoundary(trace, "process.send");
    writeEvent("process-send", {
      traceId: trace?.traceId || null,
      args: previewArgs(args),
      stack: captureStack(),
    });
    return originalProcessSend.apply(this, args);
  };
  process.send.__windsurfHooked = true;
}

function instrumentAuthProvider(providerId, provider) {
  if (!provider || typeof provider !== "object" || provider.__windsurfAuthProviderHooked) return;
  provider.__windsurfAuthProviderHooked = true;
  authHydrationState.providerRegisteredAt = new Date().toISOString();
  emitAuthTimeline("auth_provider_registered", {
    providerId,
    providerShape: inspectProvider(provider),
  });

  if (typeof provider.initializeCachedSessions === "function" && !provider.initializeCachedSessions.__windsurfAuthTraceHooked) {
    const originalInitializeCachedSessions = provider.initializeCachedSessions;
    provider.initializeCachedSessions = async function patchedInitializeCachedSessions(...args) {
      authHydrationState.initializeCachedSessionsStartedAt = new Date().toISOString();
      emitAuthTimeline("initialize_cached_sessions_start", {
        providerId,
        args: previewArgs(args),
      });
      const rawSessionsKey = typeof this.constructor?.getSessionsSecretKey === "function"
        ? this.constructor.getSessionsSecretKey()
        : "windsurf_auth.sessions";
      const rawApiServerKey = typeof this.constructor?.getApiServerUrlSecretKey === "function"
        ? this.constructor.getApiServerUrlSecretKey()
        : "windsurf_auth.apiServerUrl";
      const rawSessions = await this.context?.secrets?.get?.(rawSessionsKey);
      const rawApiServerUrl = await this.context?.secrets?.get?.(rawApiServerKey);
      const result = await originalInitializeCachedSessions.apply(this, args);
      const sessions = Array.isArray(this._cachedSessions) ? this._cachedSessions : null;
      authHydrationState.initializeCachedSessionsCompletedAt = new Date().toISOString();
      authHydrationState.initializeCachedSessionsCompleted = true;
      authHydrationState.initializeCachedSessionsSessionsLength = sessions ? sessions.length : null;
      emitAuthTimeline("initialize_cached_sessions_complete", {
        providerId,
        sessionsLength: sessions ? sessions.length : null,
        rawSessionsPresent: typeof rawSessions === "string" && rawSessions.length > 0,
        rawApiServerUrlPresent: typeof rawApiServerUrl === "string" && rawApiServerUrl.length > 0,
        rawSessionsPreview: previewSecretLikeValue(rawSessions),
        rawApiServerUrlPreview: previewSecretLikeValue(rawApiServerUrl),
      });
      return result;
    };
    provider.initializeCachedSessions.__windsurfAuthTraceHooked = true;
  }

  if (typeof provider.onDidChangeSessions === "function" && !provider.onDidChangeSessions.__windsurfAuthTraceHooked) {
    const originalOnDidChangeSessions = provider.onDidChangeSessions;
    provider.onDidChangeSessions = function patchedOnDidChangeSessions(...args) {
      const event = originalOnDidChangeSessions.apply(this, args);
      if (typeof event === "function" && !event.__windsurfAuthTraceHooked) {
        const wrappedEvent = (listener, thisArgs, disposables) => event.call(this, (...eventArgs) => {
          emitAuthTimeline("on_did_change_sessions_fired", {
            providerId,
            eventArgs: previewArgs(eventArgs),
          });
          return listener(...eventArgs);
        }, thisArgs, disposables);
        wrappedEvent.__windsurfAuthTraceHooked = true;
        return wrappedEvent;
      }
      return event;
    };
    provider.onDidChangeSessions.__windsurfAuthTraceHooked = true;
  }
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  try {
    const filename = Module._resolveFilename(request, parent, isMain);
    if (typeof filename === "string" && /windsurf|@exa\\chat-client|extensionHostProcess|workbench\.desktop\.main/i.test(filename)) {
      writeEvent("module-load", { request, filename, parent: parent?.filename || null });
    }

    if (typeof filename === "string" && /better-sqlite3/i.test(filename) && exported?.prototype?.prepare) {
      const Database = exported;
      if (!Database.__windsurfHooked) {
        Database.__windsurfHooked = true;
        const originalPrepare = Database.prototype.prepare;
        Database.prototype.prepare = function patchedPrepare(sql) {
          const stmt = originalPrepare.call(this, sql);
          if (typeof sql === "string" && /ItemTable/i.test(sql) && /INSERT|UPDATE|REPLACE/i.test(sql)) {
            for (const methodName of ["run", "get", "all"]) {
              if (typeof stmt[methodName] !== "function" || stmt[methodName].__windsurfHooked) continue;
              const originalMethod = stmt[methodName];
              stmt[methodName] = function patchedStatementMethod(...methodArgs) {
                if (JSON.stringify(methodArgs).includes("chat.modelsControl")) {
                  writeEvent("state-db-write", { sql, methodName, args: methodArgs });
                }
                return originalMethod.apply(this, methodArgs);
              };
              stmt[methodName].__windsurfHooked = true;
            }
          }
          return stmt;
        };
      }
    }

    if (typeof filename === "string" && /electron[\\/].*(renderer|preload|webview)|preload\.js$/i.test(filename) && exported && typeof exported === "object") {
      const ipcRenderer = exported.ipcRenderer;
      if (WINDSURF_DEBUG_ELECTRON && ipcRenderer && typeof ipcRenderer === "object") {
        if (typeof ipcRenderer.send === "function" && !ipcRenderer.send.__windsurfElectronDebugHooked) {
          const originalSend = ipcRenderer.send;
          ipcRenderer.send = function patchedIpcRendererSend(channel, ...args) {
            writeEvent("electron-ipc-renderer-outbound", {
              channel,
              kind: "send",
              args: summarizeIpcArgs(args),
            });
            return originalSend.call(this, channel, ...args);
          };
          ipcRenderer.send.__windsurfElectronDebugHooked = true;
        }

        if (typeof ipcRenderer.invoke === "function" && !ipcRenderer.invoke.__windsurfElectronDebugHooked) {
          const originalInvoke = ipcRenderer.invoke;
          ipcRenderer.invoke = function patchedIpcRendererInvoke(channel, ...args) {
            writeEvent("electron-ipc-renderer-outbound", {
              channel,
              kind: "invoke",
              args: summarizeIpcArgs(args),
            });
            return originalInvoke.call(this, channel, ...args);
          };
          ipcRenderer.invoke.__windsurfElectronDebugHooked = true;
        }

        if (typeof ipcRenderer.on === "function" && !ipcRenderer.on.__windsurfElectronDebugHooked) {
          const originalOn = ipcRenderer.on;
          ipcRenderer.on = function patchedIpcRendererOn(channel, listener) {
            return originalOn.call(this, channel, function wrappedIpcRendererListener(event, ...args) {
              writeEvent("electron-ipc-renderer-inbound", {
                channel,
                kind: "on",
                args: summarizeIpcArgs(args),
              });
              return listener.call(this, event, ...args);
            });
          };
          ipcRenderer.on.__windsurfElectronDebugHooked = true;
        }
      }
    }

    if (typeof filename === "string" && /extensionHostProcess\.js$/i.test(filename) && exported && typeof exported === "object") {
      const authentication = exported.authentication;
      if (authentication && typeof authentication === "object") {
        if (typeof authentication.getSession === "function" && !authentication.getSession.__windsurfAuthTraceHooked) {
          const originalGetSession = authentication.getSession;
          authentication.getSession = async function patchedAuthenticationGetSession(...args) {
            const providerId = typeof args[0] === "string" ? args[0] : null;
            const order = nextAuthOrder();
            const timestamp = new Date().toISOString();
            if (!authHydrationState.firstGetSessionAt) {
              authHydrationState.firstGetSessionAt = timestamp;
              authHydrationState.firstGetSessionOrder = order;
              authHydrationState.firstGetSessionProviderId = providerId;
            }
            const result = await originalGetSession.apply(this, args);
            const hasAccessToken = !!(result && typeof result.accessToken === "string" && result.accessToken.length > 0);
            if (authHydrationState.firstGetSessionHadAccessToken === null) {
              authHydrationState.firstGetSessionHadAccessToken = hasAccessToken;
            }
            writeAuthEvent("authentication_get_session", {
              order,
              providerId,
              scopes: Array.isArray(args[1]) ? args[1] : null,
              options: summarizeValue(args[2]),
              sessionExists: !!result,
              hasAccessToken,
              authHydrationReady: computeAuthHydrationReady(),
              isFirstGetSession: authHydrationState.firstGetSessionAt === timestamp,
            });
            return result;
          };
          authentication.getSession.__windsurfAuthTraceHooked = true;
        }

        if (typeof authentication.registerAuthenticationProvider === "function" && !authentication.registerAuthenticationProvider.__windsurfAuthTraceHooked) {
          const originalRegisterAuthenticationProvider = authentication.registerAuthenticationProvider;
          authentication.registerAuthenticationProvider = function patchedRegisterAuthenticationProvider(...args) {
            const providerId = typeof args[0] === "string" ? args[0] : null;
            const provider = args[2];
            const result = originalRegisterAuthenticationProvider.apply(this, args);
            instrumentAuthProvider(providerId, provider);
            return result;
          };
          authentication.registerAuthenticationProvider.__windsurfAuthTraceHooked = true;
        }
      }
    }

    if (typeof filename === "string" && /extensionStorage/i.test(filename) && exported && typeof exported === "object") {
      for (const key of ["ExtensionStorage", "default"]) {
        const candidate = exported[key];
        if (!candidate || typeof candidate !== "function") continue;
        const proto = candidate.prototype;
        if (!proto) continue;
        for (const methodName of ["getStoredValue", "setStoredValue"]) {
          const originalMethod = proto[methodName];
          if (typeof originalMethod !== "function" || originalMethod.__windsurfAuthTraceHooked) continue;
          proto[methodName] = function patchedExtensionStorageMethod(...args) {
            const origin = captureOrigin(`extensionStorage.${methodName}`);
            const result = originalMethod.apply(this, args);
            const logResolved = (resolved) => {
              const keyName = typeof args[0] === "string" ? args[0] : null;
              const interesting = keyName && /PENDING_API_KEY_MIGRATION|API_KEY|AUTH/i.test(keyName);
              if (interesting) {
                writeEvent(`extension-storage-${methodName}`, {
                  keyName,
                  args: previewArgs(args),
                  result: summarizeValue(resolved),
                  resultPreview: previewSecretLikeValue(resolved),
                  resultKeyType: classifyObservedKey(resolved),
                  stack: origin.stack,
                });
                writeAuthEvent(`extension_storage_${methodName}`, {
                  keyName,
                  value: resolved,
                  keyType: classifyObservedKey(resolved),
                  source: origin.stack,
                  stackFrames: origin.stackFrames,
                  sourceLabel: origin.label,
                  traceId: traces.getActiveTraceId(),
                });
              }
              return resolved;
            };
            if (result && typeof result.then === "function") {
              return result.then((resolved) => logResolved(resolved));
            }
            return logResolved(result);
          };
          proto[methodName].__windsurfAuthTraceHooked = true;
        }
      }
    }

    if (typeof filename === "string" && /@connectrpc[\\/](connect-web|connect)[\\/].*(connect-transport|promise-client|index)\.js$/i.test(filename) && exported && typeof exported === "object") {
      for (const key of Object.keys(exported)) {
        if (!/createConnectTransport|createPromiseClient/i.test(key)) continue;
        const original = exported[key];
        if (typeof original !== "function" || original.__windsurfHooked) continue;
        exported[key] = function patchedConnectRpcFactory(...args) {
          const trace = captureCurrentTrace();
          markFirstAsyncBoundary(trace, key);
          writeEvent("connectrpc-factory-call", {
            traceId: trace?.traceId || null,
            key,
            args: previewArgs(args),
            stack: captureStack(),
          });
          const result = original.apply(this, args);
          const wrappedResult = /createPromiseClient/i.test(key) ? wrapPromiseClient(result) : result;
          writeEvent("connectrpc-factory-result", {
            traceId: trace?.traceId || null,
            key,
            result: summarizeValue(wrappedResult),
          });
          return wrappedResult;
        };
        exported[key].__windsurfHooked = true;
      }
    }

    if (typeof filename === "string" && /extensions[\\/]windsurf[\\/]dist[\\/]extension\.js$/i.test(filename) && exported && typeof exported === "object") {
      if (typeof exported.getAuthSession === "function" && !exported.getAuthSession.__windsurfAuthTraceHooked) {
        const originalGetAuthSession = exported.getAuthSession;
        exported.getAuthSession = async function patchedGetAuthSession(...args) {
          const origin = captureOrigin("extension.getAuthSession");
          const result = await originalGetAuthSession.apply(this, args);
          writeEvent("auth-session-read", {
            args: previewArgs(args),
            result: summarizeValue(result),
            accessTokenPreview: previewSecretLikeValue(result?.accessToken),
            accessTokenType: classifyObservedKey(result?.accessToken),
            stack: origin.stack,
          });
          writeAuthEvent("auth_session_read", {
            accessToken: result?.accessToken,
            keyType: classifyObservedKey(result?.accessToken),
            source: origin.stack,
            stackFrames: origin.stackFrames,
            sourceLabel: origin.label,
            traceId: traces.getActiveTraceId(),
          });
          return result;
        };
        exported.getAuthSession.__windsurfAuthTraceHooked = true;
      }
    }

    if (typeof filename === "string" && /@exa[\\/]chat-client[\\/]index\.js$/i.test(filename) && exported && typeof exported === "object") {
      if (typeof exported.getChatParams === "function" && !exported.getChatParams.__windsurfHooked) {
        const originalGetChatParams = exported.getChatParams;
        exported.getChatParams = async function patchedGetChatParams(...args) {
          const result = await originalGetChatParams.apply(this, args);
          const languageServerUrl = typeof result?.languageServerUrl === "string" ? result.languageServerUrl : null;
          const csrfToken = typeof result?.csrfToken === "string" ? result.csrfToken : null;
          writeEvent("chat-client-getChatParams", {
            args: previewArgs(args),
            result: summarizeValue(result),
          });
          if (languageServerUrl || csrfToken) {
            recordBootstrapStep("chatClient.getChatParams", {
              languageServerUrl,
              csrfToken,
            });
            writeLiveCsrfEvent("getChatParams", {
              csrfToken,
              languageServerUrl,
              traceId: traces.getActiveTraceId(),
              origin: "chatClient.getChatParams",
              stack: captureStack().split("\n").slice(0, 6),
            });
          }
          return result;
        };
        exported.getChatParams.__windsurfHooked = true;
      }
      const wrapMethod = (owner, key) => {
        if (!owner || typeof owner[key] !== "function" || owner[key].__windsurfHooked) return;
        const original = owner[key];
        owner[key] = function patchedMethod(...args) {
          const trace = captureCurrentTrace();
          markFirstAsyncBoundary(trace, `chat-client.${key}`);
          const result = original.apply(this, args);
          writeEvent("chat-client-call", { traceId: trace?.traceId || null, key, args: previewArgs(args), stack: captureStack() });
          if (result && typeof result.then === "function") {
            return result.then((resolved) => {
              writeEvent("chat-client-result", { traceId: trace?.traceId || null, key, resolved: summarizeValue(resolved) });
              return resolved;
            });
          }
          writeEvent("chat-client-result", { traceId: trace?.traceId || null, key, resolved: summarizeValue(result) });
          return result;
        };
        owner[key].__windsurfHooked = true;
      };

      for (const key of Object.keys(exported)) {
        if (/protoToBinaryBase64|fromBinary|fromJsonString|fromJson/i.test(key)) {
          wrapMethod(exported, key);
        }
      }
    }

    if (typeof filename === "string" && /extensions[\\/]windsurf[\\/]dist[\\/]extension\.js$/i.test(filename) && exported && typeof exported === "object") {
      for (const [exportName, value] of Object.entries(exported)) {
        if (typeof value === "function") {
          const hookedClass = hookChatRequestClass(value);
          if (hookedClass !== value) {
            exported[exportName] = hookedClass;
            continue;
          }
        }
        if (typeof value !== "function" || value.__windsurfBootstrapHooked) continue;
        const original = value;
        value.__windsurfBootstrapHooked = true;
        exported[exportName] = function patchedWindsurfExport(...args) {
          if (/initialize/i.test(exportName) && args.length >= 1) {
            writeEvent("windsurf-export-call", {
              exportName,
              args: previewArgs(args),
              stack: captureStack(),
            });
          }
          const result = original.apply(this, args);
          if (/initialize/i.test(exportName) && args.length >= 2 && typeof args[0] === "string") {
            const patch = { csrfToken: args[0] };
            if (typeof args[1] === "string" && /^https?:/i.test(args[1])) {
              patch.apiUrl = args[1];
            }
            recordBootstrapStep(`extensionExport.${exportName}`, patch);
          }
          return result;
        };
      }

      const instrumentObjectMethods = (obj, label, methodNames) => {
        if (!obj || typeof obj !== "object") return;
        for (const methodName of methodNames) {
          const originalMethod = obj[methodName];
          if (typeof originalMethod !== "function" || originalMethod.__windsurfHooked) continue;
          obj[methodName] = function patchedMethod(...args) {
            writeEvent("windsurf-object-method-call", {
              label,
              methodName,
              args: previewArgs(args),
              stack: captureStack(),
            });
            if (methodName === "setCsrfToken" && typeof args[0] === "string") {
              const previousValue = bootstrapState.csrfToken;
              recordBootstrapStep(`${label}.setCsrfToken`, { csrfToken: args[0] });
              writeLiveCsrfEvent("setCsrfToken", {
                previousValue,
                newValue: args[0],
                sourceObject: label,
                origin: `${label}.setCsrfToken`,
                traceId: traces.getActiveTraceId(),
              });
            }
            if (methodName === "initialize") {
              const patch = {};
              if (typeof args[0] === "string") patch.csrfToken = args[0];
              if (typeof args[1] === "string" && /^https?:/i.test(args[1])) patch.apiUrl = args[1];
              if (Object.keys(patch).length > 0) {
                recordBootstrapStep(`${label}.initialize`, patch);
                writeLiveCsrfEvent("initialize", {
                  csrfToken: patch.csrfToken || null,
                  apiUrl: patch.apiUrl || null,
                  sourceObject: label,
                  origin: `${label}.initialize`,
                  traceId: traces.getActiveTraceId(),
                });
              }
            }
            const result = originalMethod.apply(this, args);
            return result;
          };
          obj[methodName].__windsurfHooked = true;
        }
      };

      const instrumentMetadataProviderClass = (candidate, label) => {
        if (typeof candidate !== "function") return;
        const proto = candidate.prototype;
        if (!proto || typeof proto.updateApiKey !== "function" || typeof proto.getMetadata !== "function") return;
        if (proto.updateApiKey.__windsurfAuthTraceHooked) return;

        const originalUpdateApiKey = proto.updateApiKey;
        proto.updateApiKey = function patchedUpdateApiKey(value, ...rest) {
          const before = this.apiKey;
          const origin = captureOrigin(`${label}.updateApiKey`, {
            className: candidate.name || null,
            previousKeyType: classifyObservedKey(before),
            previousKeyPreview: previewSecretLikeValue(before),
            nextKeyType: classifyObservedKey(value),
            nextKeyPreview: previewSecretLikeValue(value),
          });
          writeAuthEvent("api_key_set", {
            value,
            keyType: classifyObservedKey(value),
            source: origin.stack,
            stackFrames: origin.stackFrames,
            sourceLabel: origin.label,
            previousValue: before,
            previousKeyType: classifyObservedKey(before),
            traceId: traces.getActiveTraceId(),
          });
          const result = originalUpdateApiKey.call(this, value, ...rest);
          writeEvent("metadata-provider-updateApiKey-call", {
            label,
            className: candidate.name || null,
            previousApiKey: previewSecretLikeValue(before),
            nextApiKey: previewSecretLikeValue(this.apiKey),
            previousKeyType: classifyObservedKey(before),
            nextKeyType: classifyObservedKey(this.apiKey),
            stack: origin.stack,
          });
          return result;
        };
        proto.updateApiKey.__windsurfAuthTraceHooked = true;

        if (typeof proto.clearAuthentication === "function" && !proto.clearAuthentication.__windsurfAuthTraceHooked) {
          const originalClearAuthentication = proto.clearAuthentication;
          proto.clearAuthentication = function patchedClearAuthentication(...args) {
            emitAuthTimeline("metadata_provider_clear_authentication", {
              label,
              className: candidate.name || null,
              args: previewArgs(args),
            });
            return originalClearAuthentication.apply(this, args);
          };
          proto.clearAuthentication.__windsurfAuthTraceHooked = true;
        }

        const originalGetMetadata = proto.getMetadata;
        proto.getMetadata = function patchedGetMetadata(...args) {
          const origin = captureOrigin(`${label}.getMetadata`, {
            className: candidate.name || null,
            currentProviderKeyType: classifyObservedKey(this.apiKey),
            currentProviderKeyPreview: previewSecretLikeValue(this.apiKey),
          });
          const result = originalGetMetadata.apply(this, args);
          writeAuthEvent("api_key_read", {
            apiKey: result?.apiKey,
            keyType: classifyObservedKey(result?.apiKey),
            source: origin.stack,
            stackFrames: origin.stackFrames,
            sourceLabel: origin.label,
            providerApiKey: this.apiKey,
            providerKeyType: classifyObservedKey(this.apiKey),
            traceId: traces.getActiveTraceId(),
          });
          writeEvent("metadata-provider-getMetadata-call", {
            label,
            className: candidate.name || null,
            args: previewArgs(args),
            providerApiKey: previewSecretLikeValue(this.apiKey),
            providerKeyType: classifyObservedKey(this.apiKey),
            resultApiKey: previewSecretLikeValue(result?.apiKey),
            resultKeyType: classifyObservedKey(result?.apiKey),
            stack: origin.stack,
          });
          return result;
        };
        proto.getMetadata.__windsurfAuthTraceHooked = true;

        const apiKeyDescriptor = Object.getOwnPropertyDescriptor(proto, "apiKey")
          || Object.getOwnPropertyDescriptor(candidate, "apiKey");
        writeEvent("metadata-provider-hook-installed", {
          label,
          className: candidate.name || null,
          prototypeKeys: safeOwnKeys(proto),
          apiKeyDescriptor: apiKeyDescriptor ? summarizeValue(apiKeyDescriptor) : null,
        });
      };

      for (const [exportName, value] of Object.entries(exported)) {
        instrumentObjectMethods(value, exportName, ["initialize", "setCsrfToken"]);
        instrumentMetadataProviderClass(value, exportName);
      }
    }

    if (typeof filename === "string" && /extensionHostProcess\.js$/i.test(filename) && exported && typeof exported === "object") {
      for (const value of Object.values(exported)) {
        if (!value || typeof value !== "function") continue;
        const proto = value.prototype;
        if (!proto || typeof proto.registerLanguageModelChatProvider !== "function" || proto.registerLanguageModelChatProvider.__windsurfHooked) continue;

        const originalRegister = proto.registerLanguageModelChatProvider;
        proto.registerLanguageModelChatProvider = function patchedRegisterLanguageModelChatProvider(t, vendor, provider) {
          const registrationTrace = createTrace("lm-register", {
            vendor,
            extension: summarizeValue(t),
            providerShape: inspectProvider(provider),
            stack: captureStack(),
          });
          writeEvent("lm-provider-registration", {
            traceId: registrationTrace.traceId,
            vendor,
            extension: summarizeValue(t),
            providerShape: inspectProvider(provider),
          });

          for (const methodName of [
            "provideLanguageModelChatResponse",
            "provideLanguageModelChatInformation",
            "provideTokenCount",
          ]) {
            let originalMethod;
            try {
              originalMethod = Reflect.get(provider, methodName, provider);
            } catch (error) {
              writeEvent("lm-provider-method-read-error", {
                traceId: registrationTrace.traceId,
                vendor,
                methodName,
                error: error.message,
              });
              continue;
            }
            if (typeof originalMethod !== "function" || originalMethod.__windsurfHooked) continue;
            writeEvent("lm-provider-method-wrapped", {
              traceId: registrationTrace.traceId,
              vendor,
              methodName,
              original: inspectFunction(originalMethod),
            });
          }

          const wrappedProvider = createProviderWrapper({
            vendor,
            provider,
            traces,
            writeEvent(type, payload) {
              writeEvent(type, {
                ...payload,
                args: Array.isArray(payload.args) ? previewArgs(payload.args) : payload.args,
              });
            },
          });

          for (const methodName of [
            "provideLanguageModelChatResponse",
            "provideLanguageModelChatInformation",
            "provideTokenCount",
          ]) {
            if (typeof wrappedProvider[methodName] !== "function") continue;
            try {
              wrappedProvider[methodName].__windsurfHooked = true;
              provider[methodName] = wrappedProvider[methodName];
            } catch (error) {
              writeEvent("lm-provider-method-wrap-error", {
                traceId: registrationTrace.traceId,
                vendor,
                methodName,
                error: error.message,
              });
            }
          }

          try {
            return originalRegister.apply(this, arguments);
          } finally {
            finishTrace(registrationTrace, { vendor, status: "registered" });
          }
        };
        proto.registerLanguageModelChatProvider.__windsurfHooked = true;
        writeEvent("lm-register-hook-installed", {
          filename,
          exportName: value.name || null,
          prototypeKeys: safeOwnKeys(proto),
        });
      }
    }
  } catch (error) {
    writeEvent("hook-error", { phase: "load", request, message: error.message });
  }
  return exported;
};

module.exports.createProviderWrapper = createProviderWrapper;
module.exports.createRpcWrapper = createRpcWrapper;
module.exports.createBootstrapState = createBootstrapState;
module.exports.observeLifecycleMethod = observeLifecycleMethod;

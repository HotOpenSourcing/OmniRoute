const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = "C:/Users/amine/OmniRoute";
const LOG_PATH = path.join(ROOT, "windsurf-electron-lifecycle-trace.jsonl");

function detectProcessSurface(argv = process.argv) {
  const joined = Array.isArray(argv) ? argv.join(" ") : "";
  if (/language_server_windows_x64\.exe/i.test(joined)) {
    return "language_server";
  }
  if (/Windsurf\.exe/i.test(joined) || /extensionHostProcess/i.test(joined)) {
    return "host";
  }
  return "unknown";
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack || null,
    };
  }
  return {
    message: typeof error === "string" ? error : String(error),
  };
}

function createEventWriter({ processObject = process, logPath = LOG_PATH } = {}) {
  const surface = detectProcessSurface(processObject.argv);
  return function writeEvent(event, payload = {}) {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      pid: processObject.pid,
      ppid: typeof processObject.ppid === "number" ? processObject.ppid : null,
      surface,
      event,
      payload,
    });
    fs.appendFileSync(logPath, `${line}\n`);
  };
}

function installProcessLifecycleHooks({ processObject = process, writeEvent } = {}) {
  const emit = writeEvent || createEventWriter({ processObject });
  processObject.on("unhandledRejection", (reason) => {
    const serialized = serializeError(reason);
    emit("process.unhandledRejection", {
      reasonMessage: serialized.message || null,
      reasonName: serialized.name || null,
      reasonStack: serialized.stack || null,
      pid: processObject.pid,
    });
  });
  processObject.on("uncaughtException", (error) => {
    const serialized = serializeError(error);
    emit("process.uncaughtException", {
      errorMessage: serialized.message || null,
      errorName: serialized.name || null,
      errorStack: serialized.stack || null,
      pid: processObject.pid,
    });
  });
  processObject.on("exit", (code) => {
    emit("process.exit", {
      code,
      pid: processObject.pid,
    });
  });
  return emit;
}

function installSpawnAttemptHook({ writeEvent } = {}) {
  const emit = writeEvent || createEventWriter({ processObject: process });
  const originalSpawn = childProcess.spawn;
  if (originalSpawn.__windsurfLifecycleTracerHooked) {
    return;
  }
  childProcess.spawn = function patchedSpawn(command, args, options) {
    emit("child_process.spawn", {
      command,
      args: Array.isArray(args) ? args : [],
      cwd: options && typeof options.cwd === "string" ? options.cwd : null,
    });
    return originalSpawn.apply(this, arguments);
  };
  childProcess.spawn.__windsurfLifecycleTracerHooked = true;
}

function installRendererDomLifecycleHooks({
  writeEvent,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  processObject = process,
} = {}) {
  const emit = writeEvent || createEventWriter({ processObject });
  if (!windowObject || !documentObject) {
    return false;
  }
  if (windowObject.__windsurfRendererDomLifecycleTracerHooked) {
    return true;
  }
  windowObject.__windsurfRendererDomLifecycleTracerHooked = true;

  const buildPayload = () => ({
    renderer_pid: typeof processObject.pid === "number" ? processObject.pid : null,
    target_id: typeof windowObject.__WINDSURF_RENDERER_TARGET_ID === "string"
      ? windowObject.__WINDSURF_RENDERER_TARGET_ID
      : null,
  });

  if (typeof documentObject.addEventListener === "function") {
    documentObject.addEventListener("DOMContentLoaded", () => {
      emit("DOMContentLoaded", buildPayload());
    });
  }
  if (typeof windowObject.addEventListener === "function") {
    windowObject.addEventListener("load", () => {
      emit("loadEventFired", buildPayload());
    });
  }
  return true;
}

function installElectronLifecycleHooks({ electron, writeEvent } = {}) {
  if (!electron || !electron.app) {
    return false;
  }
  const emit = writeEvent || createEventWriter({ processObject: process });
  const { app, BrowserWindow } = electron;

  emit("electron.module.loaded", {
    hasApp: !!app,
    hasBrowserWindow: !!BrowserWindow,
  });

  if (!app.__windsurfLifecycleTracerHooked) {
    app.__windsurfLifecycleTracerHooked = true;
    app.on("ready", () => {
      emit("electron.app.ready", {});
    });
    if (typeof app.whenReady === "function") {
      app.whenReady().then(() => {
        emit("electron.app.whenReady.resolved", {});
      }, (error) => {
        const serialized = serializeError(error);
        emit("electron.app.whenReady.rejected", {
          errorMessage: serialized.message || null,
          errorName: serialized.name || null,
          errorStack: serialized.stack || null,
        });
      });
    }
  }

  if (BrowserWindow && BrowserWindow.prototype && !BrowserWindow.prototype.__windsurfLifecycleTracerHooked) {
    const OriginalBrowserWindow = BrowserWindow;
    const PatchedBrowserWindow = function patchedBrowserWindow(...args) {
      emit("electron.browserWindow.created", {
        argsCount: args.length,
      });
      return Reflect.construct(OriginalBrowserWindow, args, new.target || PatchedBrowserWindow);
    };
    Object.setPrototypeOf(PatchedBrowserWindow, OriginalBrowserWindow);
    PatchedBrowserWindow.prototype = OriginalBrowserWindow.prototype;
    PatchedBrowserWindow.prototype.__windsurfLifecycleTracerHooked = true;
    electron.BrowserWindow = PatchedBrowserWindow;
  }

  return true;
}

function tryInstallElectronLifecycleHooks({ writeEvent, resolveElectron } = {}) {
  const emit = writeEvent || createEventWriter({ processObject: process });
  const loadElectron = typeof resolveElectron === "function"
    ? resolveElectron
    : () => require("electron");

  try {
    const electron = loadElectron();
    const installed = installElectronLifecycleHooks({ electron, writeEvent: emit });
    emit("electron.lifecycle.hooks", { installed });
    return installed;
  } catch (error) {
    const serialized = serializeError(error);
    emit("electron.lifecycle.unavailable", {
      errorMessage: serialized.message || null,
      errorName: serialized.name || null,
      errorStack: serialized.stack || null,
    });
    return false;
  }
}

function runLifecycleTracer({
  mode = process.env.WINDSURF_LIFECYCLE_TRACER_MODE || "full",
  processObject = process,
  writeEvent,
  installProcessLifecycleHooks: installProcessHooksImpl = installProcessLifecycleHooks,
  installSpawnAttemptHook: installSpawnHookImpl = installSpawnAttemptHook,
  installRendererDomLifecycleHooks: installRendererHooksImpl = installRendererDomLifecycleHooks,
  tryInstallElectronLifecycleHooks: tryInstallElectronHooksImpl = tryInstallElectronLifecycleHooks,
} = {}) {
  const emit = writeEvent || createEventWriter({ processObject });
  emit("lifecycle-tracer.loaded", {
    argv: processObject.argv,
    cwd: typeof processObject.cwd === "function" ? processObject.cwd() : null,
  });
  if (mode === "loaded-only") {
    return emit;
  }
  installProcessHooksImpl({ processObject, writeEvent: emit });
  installSpawnHookImpl({ writeEvent: emit });
  const domHooksInstalled = installRendererHooksImpl({ writeEvent: emit, processObject });
  emit("renderer.dom.lifecycle.hooks", { installed: domHooksInstalled });
  tryInstallElectronHooksImpl({ writeEvent: emit });
  return emit;
}

function main() {
  fs.writeFileSync(LOG_PATH, "");
  runLifecycleTracer();
}

if (!globalThis.__WINDSURF_ELECTRON_LIFECYCLE_TRACER_LOADED) {
  globalThis.__WINDSURF_ELECTRON_LIFECYCLE_TRACER_LOADED = true;
  main();
}

module.exports = {
  LOG_PATH,
  detectProcessSurface,
  createEventWriter,
  installProcessLifecycleHooks,
  installSpawnAttemptHook,
  installRendererDomLifecycleHooks,
  installElectronLifecycleHooks,
  runLifecycleTracer,
  tryInstallElectronLifecycleHooks,
};

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  installProcessLifecycleHooks,
  installRendererDomLifecycleHooks,
  runLifecycleTracer,
  tryInstallElectronLifecycleHooks,
} = require("../../scripts/scratch/windsurf-electron-lifecycle-tracer.cjs");

test("installProcessLifecycleHooks records exit and async failure checkpoints", async () => {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const processLike = {
    pid: 4242,
    ppid: 31337,
    argv: ["Windsurf.exe"],
    cwd() {
      return "C:/Users/amine/OmniRoute";
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, handler);
      return processLike;
    },
  };

  installProcessLifecycleHooks({
    processObject: processLike,
    writeEvent(event: string, payload: Record<string, unknown>) {
      events.push({ event, payload });
    },
  });

  handlers.get("unhandledRejection")?.(new Error("boom"));
  handlers.get("uncaughtException")?.(new Error("crash"));
  handlers.get("exit")?.(7);

  assert.deepEqual(
    events.map((entry) => entry.event),
    [
      "process.unhandledRejection",
      "process.uncaughtException",
      "process.exit",
    ],
  );
  assert.equal(events[0]?.payload?.reasonMessage, "boom");
  assert.equal(events[1]?.payload?.errorMessage, "crash");
  assert.equal(events[2]?.payload?.code, 7);
  assert.equal(events[2]?.payload?.pid, 4242);
});

test("installRendererDomLifecycleHooks records positive renderer lifecycle without electron module", () => {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const listeners = new Map<string, () => void>();
  const documentLike = {
    addEventListener(event: string, handler: () => void) {
      listeners.set(event, handler);
    },
  };
  const windowLike = {
    __WINDSURF_RENDERER_TARGET_ID: "target-live",
    addEventListener(event: string, handler: () => void) {
      listeners.set(`window:${event}`, handler);
    },
  };

  const installed = installRendererDomLifecycleHooks({
    writeEvent(event: string, payload: Record<string, unknown>) {
      events.push({ event, payload });
    },
    documentObject: documentLike,
    windowObject: windowLike,
    processObject: { pid: 20400 },
  });

  assert.equal(installed, true);
  listeners.get("DOMContentLoaded")?.();
  listeners.get("window:load")?.();

  assert.deepEqual(events.map((entry) => entry.event), [
    "DOMContentLoaded",
    "loadEventFired",
  ]);
  assert.equal(events[0]?.payload?.renderer_pid, 20400);
  assert.equal(events[0]?.payload?.target_id, "target-live");
});

test("runLifecycleTracer loaded-only mode avoids installing bootstrap hooks", () => {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  let processHooksInstalled = false;
  let spawnHooksInstalled = false;
  let domHooksInstalled = false;
  let electronHooksAttempted = false;

  runLifecycleTracer({
    mode: "loaded-only",
    processObject: {
      pid: 11364,
      ppid: 25344,
      argv: ["Windsurf.exe"],
      cwd() {
        return "C:/Users/amine/OmniRoute";
      },
      on() {
        processHooksInstalled = true;
        return this;
      },
    },
    writeEvent(event: string, payload: Record<string, unknown>) {
      events.push({ event, payload });
    },
    installProcessLifecycleHooks() {
      processHooksInstalled = true;
      return () => undefined;
    },
    installSpawnAttemptHook() {
      spawnHooksInstalled = true;
    },
    installRendererDomLifecycleHooks() {
      domHooksInstalled = true;
      return true;
    },
    tryInstallElectronLifecycleHooks() {
      electronHooksAttempted = true;
      return false;
    },
  });

  assert.deepEqual(events.map((entry) => entry.event), [
    "lifecycle-tracer.loaded",
  ]);
  assert.equal(processHooksInstalled, false);
  assert.equal(spawnHooksInstalled, false);
  assert.equal(domHooksInstalled, false);
  assert.equal(electronHooksAttempted, false);
});

test("tryInstallElectronLifecycleHooks is preload-safe when electron is not resolvable", () => {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];

  const installed = tryInstallElectronLifecycleHooks({
    writeEvent(event: string, payload: Record<string, unknown>) {
      events.push({ event, payload });
    },
    resolveElectron() {
      throw new Error("Cannot find module 'electron'");
    },
  });

  assert.equal(installed, false);
  assert.deepEqual(events.map((entry) => entry.event), [
    "electron.lifecycle.unavailable",
  ]);
  assert.match(String(events[0]?.payload?.errorMessage), /Cannot find module 'electron'/);
});

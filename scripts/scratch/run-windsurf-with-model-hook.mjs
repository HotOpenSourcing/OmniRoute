import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = "C:/Users/amine/OmniRoute";
const WINDSURF_EXE = "C:/Users/amine/AppData/Local/Programs/Windsurf/Windsurf.exe";
const defaultHook = path.join(ROOT, "scripts/scratch/windsurf-model-runtime-hook.cjs");
const lifecycleHook = path.join(ROOT, "scripts/scratch/windsurf-electron-lifecycle-tracer.cjs");
const noopHook = path.join(ROOT, "scripts/scratch/windsurf-empty-preload.cjs");
const hookMode = process.env.WINDSURF_HOOK_MODE || "runtime-broad";
const HOOK = hookMode === "lifecycle-minimal"
  ? lifecycleHook
  : hookMode === "noop"
    ? noopHook
    : defaultHook;
const LOG = path.join(ROOT, "windsurf-model-runtime-capture.jsonl");
const AUTH_LOG = path.join(ROOT, "windsurf-auth-runtime-capture.jsonl");
const NETLOG = path.join(ROOT, "windsurf-netlog.json");
const OUT = path.join(ROOT, "windsurf-model-runtime-launch.json");
const enableNetlog = /^(1|true|yes)$/i.test(process.env.WINDSURF_ENABLE_NETLOG ?? "");
if (!fs.existsSync(WINDSURF_EXE)) {
  throw new Error(`Windsurf executable not found: ${WINDSURF_EXE}`);
}
if (!fs.existsSync(HOOK)) {
  throw new Error(`Hook file not found: ${HOOK}`);
}

fs.writeFileSync(LOG, "");
fs.writeFileSync(AUTH_LOG, "");
if (enableNetlog && fs.existsSync(NETLOG)) {
  fs.unlinkSync(NETLOG);
}

const normalizedHook = HOOK.replace(/\\/g, "/");
const hookRequire = `--require=${normalizedHook}`;
const injectionMode = process.env.WINDSURF_INJECTION_MODE?.trim() || "both";

function buildInjectedOption(currentValue, enabled) {
  if (!enabled) {
    return currentValue ?? "";
  }
  const baseValue = currentValue ? `${currentValue} ` : "";
  return `${baseValue}${hookRequire}`;
}

const nodeOptions = buildInjectedOption(process.env.NODE_OPTIONS, injectionMode === "both" || injectionMode === "node-only");
const vscodeNodeOptions = buildInjectedOption(process.env.VSCODE_NODE_OPTIONS, injectionMode === "both" || injectionMode === "vscode-only");
const debugElectron = /^(1|true|yes)$/i.test(process.env.WINDSURF_DEBUG_ELECTRON ?? "");

const isolatedProfileDir = process.env.WINDSURF_USER_DATA_DIR?.trim() || "";
const workspacePath = process.env.WINDSURF_WORKSPACE_PATH?.trim() || "";
const remoteDebuggingPort = process.env.WINDSURF_REMOTE_DEBUGGING_PORT?.trim() || "";
const args = ["--new-window"];
if (remoteDebuggingPort) {
  args.push(`--remote-debugging-port=${remoteDebuggingPort}`);
}
if (enableNetlog) {
  args.push(
    `--log-net-log=${NETLOG}`,
    "--net-log-capture-mode=IncludeSensitive",
  );
}
if (isolatedProfileDir) {
  args.push(`--user-data-dir=${isolatedProfileDir}`);
}
if (workspacePath) {
  args.push(workspacePath);
}
const scenario = process.env.WINDSURF_TRACE_SCENARIO || "unlabeled";

const child = spawn(WINDSURF_EXE, args, {
  cwd: ROOT,
  detached: false,
  windowsHide: false,
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    VSCODE_NODE_OPTIONS: vscodeNodeOptions,
    WINDSURF_DEBUG_ELECTRON: debugElectron ? "1" : (process.env.WINDSURF_DEBUG_ELECTRON ?? ""),
  },
  stdio: "ignore",
});

const result = {
  at: new Date().toISOString(),
  pid: child.pid ?? null,
  executable: WINDSURF_EXE,
  args,
  hook: HOOK,
  hookMode,
  injectionMode,
  normalizedHook,
  log: LOG,
  authLog: AUTH_LOG,
  netlog: enableNetlog ? NETLOG : null,
  traceMode: "deterministic-runtime-trace",
  scenario,
  reports: path.join(ROOT, "windsurf-model-runtime-report.json"),
  remoteDebuggingPort: remoteDebuggingPort || null,
  nodeOptions,
  vscodeNodeOptions,
  captureMode: enableNetlog ? "hook-plus-chromium-netlog" : "hook-only",
  enableNetlog,
  debugElectron,
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

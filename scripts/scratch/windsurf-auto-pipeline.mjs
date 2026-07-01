import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = "C:/Users/amine/OmniRoute";
const LAUNCHER = path.join(ROOT, "scripts/scratch/run-windsurf-with-model-hook.mjs");
const LIVENESS = path.join(ROOT, "tmp_windsurf_runtime_liveness_watch_20260502.py");
const CDP_INJECT = path.join(ROOT, "scripts/windsurf_cdp_inject.py");
const LIVENESS_STATUS = path.join(ROOT, "tmp_windsurf_runtime_liveness_status_20260502.json");
const REPORT_PATH = path.join(ROOT, "windsurf-model-runtime-report.json");
const CAPTURE_PATH = path.join(ROOT, "windsurf-model-runtime-capture.jsonl");
const OUTPUT_PATH = path.join(ROOT, "tmp_windsurf_auto_pipeline_result_20260502.json");

function spawnAndCollect(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...(options.env || {}) },
      shell: false,
      windowsHide: true,
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function waitForLiveness(timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const status = await readJson(LIVENESS_STATUS);
      if (status.runtime_status === "LIVE" && status.attach_allowed === true) {
        return status;
      }
    } catch {}
    await sleep(1000);
  }
  throw new Error("Liveness did not reach LIVE/attach_allowed within timeout");
}

function deriveCascadeState(report, captureText) {
  const traceCount = typeof report?.traceCount === "number" ? report.traceCount : null;
  const sessionIdMatch = captureText.match(/"sessionId"\s*:\s*"([^"]+)"/i);
  return {
    startCascade: /StartCascade/i.test(captureText),
    sendUserCascadeMessage: /SendUserCascadeMessage|hello_probe_001/i.test(captureText),
    traceCount,
    sessionId: sessionIdMatch ? sessionIdMatch[1] : null,
    assistantResponseObserved: /assistant|cascade response|inference_response/i.test(captureText),
  };
}

async function main() {
  const message = process.argv[2] || "hello_probe_001";

  const launch = await spawnAndCollect("node", [LAUNCHER], {
    env: {
      WINDSURF_HOOK_MODE: "runtime-broad",
      WINDSURF_INJECTION_MODE: "both",
      WINDSURF_TRACE_SCENARIO: "auto-pipeline",
      WINDSURF_REMOTE_DEBUGGING_PORT: "9222",
      WINDSURF_DEBUG_ELECTRON: "1",
    },
  });

  if (launch.code !== 0) {
    throw new Error(`Launch failed: ${launch.stderr || launch.stdout}`);
  }

  const liveness = await waitForLiveness();

  await sleep(3000);

  const injection = await spawnAndCollect("python", [CDP_INJECT, "--port", "9222", "--message", message]);

  await sleep(3000);

  const report = await readJson(REPORT_PATH);
  const captureText = await readText(CAPTURE_PATH);
  const cascade = deriveCascadeState(report, captureText);

  const result = {
    generatedAt: new Date().toISOString(),
    message,
    launch: {
      code: launch.code,
      stdout: launch.stdout.trim(),
      stderr: launch.stderr.trim(),
    },
    liveness,
    injection: {
      code: injection.code,
      stdout: injection.stdout.trim(),
      stderr: injection.stderr.trim(),
    },
    cascade,
    llmExecutionConfirmed: cascade.startCascade
      && cascade.sendUserCascadeMessage
      && typeof cascade.traceCount === "number"
      && cascade.traceCount > 0
      && typeof cascade.sessionId === "string"
      && cascade.sessionId.length > 0
      && cascade.assistantResponseObserved,
  };

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

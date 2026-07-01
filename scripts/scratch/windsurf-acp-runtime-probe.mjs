import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

import { bootstrapEnv } from "../bootstrap-env.mjs";

const env = bootstrapEnv({ quiet: true });
Object.assign(process.env, env);

const { getProviderConnections } = await import("../../src/lib/db/providers.ts");

const [connection] = await getProviderConnections({ provider: "windsurf", isActive: true });
if (!connection) {
  throw new Error("No active Windsurf connection found");
}

const apiKey = String(connection.apiKey || connection.accessToken || "").trim();
const apiServerUrl = String(
  connection.providerSpecificData?.apiServerUrl || "https://server.self-serve.windsurf.com"
);

const command = path.join(
  process.env.LOCALAPPDATA || "C:/Users/amine/AppData/Local",
  "Programs",
  "Windsurf",
  "resources",
  "app",
  "extensions",
  "windsurf",
  "devin",
  "bin",
  process.platform === "win32" ? "devin.exe" : "devin"
);

function redactToken(value) {
  if (typeof value !== "string") return { present: false };
  return {
    present: true,
    length: value.length,
    startsWithEnc: value.startsWith("enc:v1:"),
    startsWithBearer: value.startsWith("Bearer "),
    startsWithDevinSession: value.startsWith("devin-session-token$"),
    prefix: value.slice(0, 8),
    suffix: value.slice(-4),
  };
}

function redactMessage(message) {
  return JSON.parse(
    JSON.stringify(message, (key, value) => (key === "api_key" ? redactToken(value) : value))
  );
}

const transcript = {
  command,
  args: ["acp", "--agent-type", "summarizer"],
  diagnostics: {
    token: redactToken(apiKey),
    apiServerUrl,
    storageEncryptionKeyPresent: Boolean(process.env.STORAGE_ENCRYPTION_KEY),
    storageEncryptionKeyLength: process.env.STORAGE_ENCRYPTION_KEY?.length || 0,
  },
  events: [],
};

const child = spawn(command, transcript.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    ACP_BACKEND: "windsurf",
  },
  windowsHide: true,
  shell: false,
});

transcript.pid = child.pid ?? null;

const stdout = readline.createInterface({ input: child.stdout });
const stderr = readline.createInterface({ input: child.stderr });
const pending = new Map();
let nextId = 1;

function add(event) {
  transcript.events.push({ at: new Date().toISOString(), ...event });
}

stdout.on("line", (line) => {
  add({ stream: "stdout", line });
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (typeof message.id === "number") {
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  }
});

stderr.on("line", (line) => add({ stream: "stderr", line }));

child.once("exit", (code, signal) => {
  add({ stream: "process", event: "exit", code, signal });
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(`process exited code=${code ?? "null"} signal=${signal ?? "null"}`));
  }
  pending.clear();
});

child.once("error", (error) => {
  add({ stream: "process", event: "error", message: error.message });
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pending.clear();
});

function send(request, timeoutMs = 45_000) {
  const id = nextId++;
  const envelope = { jsonrpc: "2.0", id, method: request.method, params: request.params };
  add({ stream: "stdin", payload: redactMessage(envelope) });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout id=${id} method=${request.method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify(envelope)}\n`);
  });
}

const promptText = process.env.WINDSURF_ACP_PROMPT || "Reply with exactly: WINDSURF_RUNTIME_OK";

const requests = {
  initialize: {
    method: "initialize",
    params: {
      protocolVersion: 1,
      clientCapabilities: {
        elicitation: { form: {} },
        _meta: {
          "cognition.ai/subagentSupport": true,
          "cognition.ai/multiRootWorkspace": true,
          "cognition.ai/partialContent": true,
          "cognition.ai/messageGrouping": true,
          "cognition.ai/otherOption": true,
          "cognition.ai/groupedSessionConfigOptions": true,
        },
      },
    },
  },
  authenticate: {
    method: "authenticate",
    params: {
      methodId: "windsurf-api-key",
      _meta: {
        api_key: apiKey,
        api_server_url: apiServerUrl,
      },
    },
  },
  newSession: {
    method: "session/new",
    params: {
      cwd: process.cwd(),
      mcpServers: [],
    },
  },
};

try {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const initializeResponse = await send(requests.initialize);
  add({ stream: "summary", method: "initialize", resultKeys: Object.keys(initializeResponse.result || {}), error: initializeResponse.error || null });

  const authenticateResponse = await send(requests.authenticate);
  add({ stream: "summary", method: "authenticate", resultKeys: Object.keys(authenticateResponse.result || {}), error: authenticateResponse.error || null });

  const newSessionResponse = await send(requests.newSession);
  const sessionId = newSessionResponse.result?.sessionId;
  add({
    stream: "summary",
    method: "session/new",
    resultKeys: Object.keys(newSessionResponse.result || {}),
    error: newSessionResponse.error || null,
    hasModels: Boolean(newSessionResponse.result?.models),
    modelsCount: Array.isArray(newSessionResponse.result?.models?.availableModels)
      ? newSessionResponse.result.models.availableModels.length
      : 0,
  });

  if (typeof sessionId === "string" && sessionId.length > 0) {
    const loadResponse = await send({
      method: "session/load",
      params: { sessionId, cwd: process.cwd(), mcpServers: [] },
    });
    add({
      stream: "summary",
      method: "session/load",
      resultKeys: Object.keys(loadResponse.result || {}),
      error: loadResponse.error || null,
      hasModels: Boolean(loadResponse.result?.models),
      modelsCount: Array.isArray(loadResponse.result?.models?.availableModels)
        ? loadResponse.result.models.availableModels.length
        : 0,
    });

    const promptResponse = await send({
      method: "session/prompt",
      params: {
        sessionId,
        prompt: [{ type: "text", text: promptText }],
      },
    }, 90_000);
    add({
      stream: "summary",
      method: "session/prompt",
      resultKeys: Object.keys(promptResponse.result || {}),
      error: promptResponse.error || null,
      responsePreview: JSON.stringify(promptResponse.result || promptResponse.error || null).slice(0, 2000),
    });
  }
} catch (error) {
  add({ stream: "probe-error", message: error instanceof Error ? error.message : String(error) });
} finally {
  stdout.close();
  stderr.close();
  child.stdin.end();

  if (child.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else if (!child.killed) {
      child.kill("SIGKILL");
    }
  }

  const stdoutMessages = transcript.events
    .filter((event) => event.stream === "stdout")
    .map((event) => {
      try {
        return JSON.parse(event.line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const stderrLines = transcript.events
    .filter((event) => event.stream === "stderr")
    .map((event) => event.line);

  transcript.analysis = {
    responses: stdoutMessages
      .filter((message) => typeof message.id !== "undefined")
      .map((message) => ({
        id: message.id,
        resultKeys: message.result ? Object.keys(message.result) : [],
        error: message.error || null,
        hasModels: Boolean(message.result?.models),
        modelsCount: Array.isArray(message.result?.models?.availableModels)
          ? message.result.models.availableModels.length
          : 0,
      })),
    notifications: stdoutMessages
      .filter((message) => message.method)
      .map((message) => ({
        method: message.method,
        updateKind: message.params?.update?.sessionUpdate || null,
        updateKeys: message.params?.update ? Object.keys(message.params.update) : [],
      })),
    stderrFlags: {
      failedModelConfigs: stderrLines.some((line) => line.includes("Failed to fetch model configs")),
      invalidApiKey: stderrLines.some((line) => line.toLowerCase().includes("invalid api key")),
      authenticationRequired: stderrLines.some((line) => line.toLowerCase().includes("authentication required")),
    },
    stderrRelevant: stderrLines.filter((line) =>
      /authenticate|model configs|Authentication required|invalid api key|telemetry|ACP: API key/.test(line)
    ),
  };

  fs.writeFileSync("windsurf-acp-session-load-probe.json", JSON.stringify(transcript, null, 2));
  console.log(JSON.stringify({ wrote: "windsurf-acp-session-load-probe.json", diagnostics: transcript.diagnostics, analysis: transcript.analysis }, null, 2));
}

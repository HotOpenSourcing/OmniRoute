import path from "node:path";

import type { ChildProcess } from "node:child_process";

import type { AcpSession } from "./manager.ts";
import { acpManager, AcpManager } from "./manager.ts";

export type JsonRpcId = string | number;

export type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

export type ModelInfo = {
  id: string;
  name: string;
  owned_by: "windsurf";
};

export type WindsurfSessionModels = {
  availableModels: ModelInfo[];
  currentModelId: string;
};

export type ModelDiscoveryStatus = "present" | "enriched" | "missing" | "failed" | "pending";
export type ModelDiscoverySource = "session/new" | "session/load" | "session/resume" | "none";
export type ModelDiscoveryReason = "auth_failure" | "registry_failure" | "not_provided" | "unknown";

export type WindsurfBootstrapResult = {
  sessionId: string;
  modes: unknown;
  configOptions: unknown[];
  models?: WindsurfSessionModels;
  modelDiscovery: {
    status: ModelDiscoveryStatus;
    source: ModelDiscoverySource;
    reason?: ModelDiscoveryReason;
  };
  diagnostics: {
    rpc: {
      requests: JsonRpcMessage[];
      responses: JsonRpcMessage[];
    };
    notifications: JsonRpcMessage[];
    stderr: string[];
  };
};

export type AcpSessionLike = Pick<
  AcpSession,
  "id" | "agentId" | "alive" | "stdoutBuffer" | "stderrBuffer" | "createdAt"
> & {
  process?: ChildProcess;
};

export interface AcpManagerLike {
  spawn(agentId: string, binary: string, args?: string[], env?: Record<string, string>): AcpSessionLike;
  sendInput(sessionId: string, input: string): boolean;
  kill(sessionId: string): boolean;
  on(event: "stdout", listener: (payload: { sessionId: string; data: string }) => void): this;
  on(event: "stderr", listener: (payload: { sessionId: string; data: string }) => void): this;
  on(event: "exit", listener: (payload: { sessionId: string; code: number | null; signal: string | null }) => void): this;
  on(event: "error", listener: (payload: { sessionId: string; error: Error }) => void): this;
  removeListener(event: "stdout", listener: (payload: { sessionId: string; data: string }) => void): this;
  removeListener(event: "stderr", listener: (payload: { sessionId: string; data: string }) => void): this;
  removeListener(
    event: "exit",
    listener: (payload: { sessionId: string; code: number | null; signal: string | null }) => void
  ): this;
  removeListener(event: "error", listener: (payload: { sessionId: string; error: Error }) => void): this;
}

export type BootstrapWindsurfSessionOptions = {
  apiKey: string;
  apiServerUrl: string;
  cwd: string;
  binary?: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  manager?: AcpManagerLike;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const WINDSURF_AGENT_ID = "windsurf";
const DEFAULT_API_SERVER_URL = "https://server.self-serve.windsurf.com";

function buildInitializeRequest(): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
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
  };
}

function buildAuthenticateRequest(apiKey: string, apiServerUrl: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "authenticate",
    params: {
      methodId: "windsurf-api-key",
      _meta: {
        api_key: apiKey,
        api_server_url: apiServerUrl,
      },
    },
  };
}

function buildNewSessionRequest(cwd: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "session/new",
    params: {
      cwd,
      mcpServers: [],
    },
  };
}

function buildLoadSessionRequest(sessionId: string, cwd: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "session/load",
    params: {
      sessionId,
      cwd,
      mcpServers: [],
    },
  };
}

function buildResumeSessionRequest(sessionId: string): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    method: "session/resume",
    params: {
      sessionId,
    },
  };
}

function getDefaultBinary(): string {
  return path.join(
    process.env.LOCALAPPDATA ?? "C:/Users/amine/AppData/Local",
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
}

function encodeRequest(id: number, request: JsonRpcMessage): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: request.method,
    params: request.params ?? {},
  })}\n`;
}

function safeParseJsonLine(line: string): JsonRpcMessage | null {
  try {
    return JSON.parse(line) as JsonRpcMessage;
  } catch {
    return null;
  }
}

function normalizeModelInfo(entry: unknown): ModelInfo | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : typeof record.modelId === "string" ? record.modelId : null;
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.displayName === "string"
        ? record.displayName
        : id;

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    owned_by: "windsurf",
  };
}

function extractModels(result: Record<string, unknown> | undefined): WindsurfSessionModels | undefined {
  if (!result || typeof result.models !== "object" || result.models === null || Array.isArray(result.models)) {
    return undefined;
  }

  const modelsRecord = result.models as Record<string, unknown>;
  const currentModelId = typeof modelsRecord.currentModelId === "string" ? modelsRecord.currentModelId : null;
  if (!Array.isArray(modelsRecord.availableModels) || !currentModelId) {
    return undefined;
  }

  const availableModels = modelsRecord.availableModels
    .map((entry) => normalizeModelInfo(entry))
    .filter((entry): entry is ModelInfo => Boolean(entry));

  if (availableModels.length === 0) {
    return undefined;
  }

  return {
    availableModels,
    currentModelId,
  };
}

function classifyMissingModels(stderrLines: string[]): {
  status: Extract<ModelDiscoveryStatus, "missing" | "failed">;
  source: "none";
  reason: ModelDiscoveryReason;
} {
  const joined = stderrLines.join("\n").toLowerCase();

  if (joined.includes("invalid api key")) {
    return {
      status: "failed",
      source: "none",
      reason: "auth_failure",
    };
  }

  if (joined.includes("failed to fetch model configs")) {
    return {
      status: "failed",
      source: "none",
      reason: "registry_failure",
    };
  }

  if (stderrLines.length === 0) {
    return {
      status: "missing",
      source: "none",
      reason: "not_provided",
    };
  }

  return {
    status: "failed",
    source: "none",
    reason: "unknown",
  };
}

async function sendRpcRequest({
  manager,
  session,
  request,
  requestId,
  timeoutMs,
  diagnostics,
}: {
  manager: AcpManagerLike;
  session: AcpSessionLike;
  request: JsonRpcMessage;
  requestId: number;
  timeoutMs: number;
  diagnostics: WindsurfBootstrapResult["diagnostics"];
}): Promise<JsonRpcMessage> {
  const requestWithId: JsonRpcMessage = {
    jsonrpc: "2.0",
    id: requestId,
    method: request.method,
    params: request.params,
  };
  diagnostics.rpc.requests.push(requestWithId);

  return await new Promise<JsonRpcMessage>((resolve, reject) => {
    const onStdout = ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (sessionId !== session.id) {
        return;
      }

      for (const line of data.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const payload = safeParseJsonLine(trimmed);
        if (!payload) {
          continue;
        }

        if (typeof payload.id !== "undefined") {
          diagnostics.rpc.responses.push(payload);
          if (payload.id === requestId) {
            cleanup();
            resolve(payload);
            return;
          }
          continue;
        }

        diagnostics.notifications.push(payload);
      }
    };

    const onStderr = ({ sessionId, data }: { sessionId: string; data: string }) => {
      if (sessionId !== session.id) {
        return;
      }

      diagnostics.stderr.push(...data.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    };

    const onExit = ({ sessionId, code, signal }: { sessionId: string; code: number | null; signal: string | null }) => {
      if (sessionId !== session.id) {
        return;
      }
      cleanup();
      reject(new Error(`Windsurf ACP exited during ${request.method} (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    };

    const onError = ({ sessionId, error }: { sessionId: string; error: Error }) => {
      if (sessionId !== session.id) {
        return;
      }
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Windsurf ACP response to ${request.method}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      manager.removeListener("stdout", onStdout);
      manager.removeListener("stderr", onStderr);
      manager.removeListener("exit", onExit);
      manager.removeListener("error", onError);
    };

    manager.on("stdout", onStdout);
    manager.on("stderr", onStderr);
    manager.on("exit", onExit);
    manager.on("error", onError);

    const written = manager.sendInput(session.id, encodeRequest(requestId, request));
    if (!written) {
      cleanup();
      reject(new Error(`Failed to write ${request.method} to Windsurf ACP session`));
    }
  });
}

export async function bootstrapWindsurfSession({
  apiKey,
  apiServerUrl = DEFAULT_API_SERVER_URL,
  cwd,
  binary = getDefaultBinary(),
  args = ["acp", "--agent-type", "summarizer"],
  env = { ACP_BACKEND: "windsurf" },
  timeoutMs = DEFAULT_TIMEOUT_MS,
  manager = acpManager,
}: BootstrapWindsurfSessionOptions): Promise<WindsurfBootstrapResult> {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("Windsurf API key is required.");
  }

  if (apiKey.startsWith("enc:v1:")) {
    throw new Error("Encrypted credentials detected – missing STORAGE_ENCRYPTION_KEY");
  }

  const diagnostics: WindsurfBootstrapResult["diagnostics"] = {
    rpc: {
      requests: [],
      responses: [],
    },
    notifications: [],
    stderr: [],
  };

  const session = manager.spawn(WINDSURF_AGENT_ID, binary, args, env);

  let requestId = 1;
  let sessionId = "";
  let modes: unknown = undefined;
  let configOptions: unknown[] = [];

  try {
    const initializeResponse = await sendRpcRequest({
      manager,
      session,
      request: buildInitializeRequest(),
      requestId: requestId++,
      timeoutMs,
      diagnostics,
    });
    if (initializeResponse.error) {
      throw new Error(initializeResponse.error.message || "Windsurf initialize failed");
    }

    const authenticateResponse = await sendRpcRequest({
      manager,
      session,
      request: buildAuthenticateRequest(apiKey, apiServerUrl),
      requestId: requestId++,
      timeoutMs,
      diagnostics,
    });
    if (authenticateResponse.error) {
      throw new Error(authenticateResponse.error.message || "Windsurf authenticate failed");
    }

    const newSessionResponse = await sendRpcRequest({
      manager,
      session,
      request: buildNewSessionRequest(cwd),
      requestId: requestId++,
      timeoutMs,
      diagnostics,
    });
    if (newSessionResponse.error) {
      throw new Error(newSessionResponse.error.message || "Windsurf session/new failed");
    }

    sessionId = typeof newSessionResponse.result?.sessionId === "string" ? newSessionResponse.result.sessionId : "";
    if (!sessionId) {
      throw new Error("Windsurf session/new response missing sessionId");
    }

    modes = newSessionResponse.result?.modes;
    configOptions = Array.isArray(newSessionResponse.result?.configOptions)
      ? (newSessionResponse.result?.configOptions as unknown[])
      : [];

    const modelsFromNew = extractModels(newSessionResponse.result);
    if (modelsFromNew) {
      return {
        sessionId,
        modes,
        configOptions,
        models: modelsFromNew,
        modelDiscovery: {
          status: "present",
          source: "session/new",
        },
        diagnostics,
      };
    }

    const loadResponse = await sendRpcRequest({
      manager,
      session,
      request: buildLoadSessionRequest(sessionId, cwd),
      requestId: requestId++,
      timeoutMs,
      diagnostics,
    });
    if (!loadResponse.error) {
      const modelsFromLoad = extractModels(loadResponse.result);
      if (modelsFromLoad) {
        return {
          sessionId,
          modes,
          configOptions,
          models: modelsFromLoad,
          modelDiscovery: {
            status: "enriched",
            source: "session/load",
          },
          diagnostics,
        };
      }
    }

    const resumeResponse = await sendRpcRequest({
      manager,
      session,
      request: buildResumeSessionRequest(sessionId),
      requestId: requestId++,
      timeoutMs,
      diagnostics,
    });
    if (!resumeResponse.error) {
      const modelsFromResume = extractModels(resumeResponse.result);
      if (modelsFromResume) {
        return {
          sessionId,
          modes,
          configOptions,
          models: modelsFromResume,
          modelDiscovery: {
            status: "enriched",
            source: "session/resume",
          },
          diagnostics,
        };
      }
    }

    return {
      sessionId,
      modes,
      configOptions,
      modelDiscovery: classifyMissingModels(diagnostics.stderr),
      diagnostics,
    };
  } finally {
    manager.kill(session.id);
  }
}

export function createWindsurfLocalAdapter(manager: AcpManagerLike = acpManager) {
  return {
    bootstrapWindsurfSession(options: Omit<BootstrapWindsurfSessionOptions, "manager">) {
      return bootstrapWindsurfSession({
        ...options,
        manager,
      });
    },
  };
}

export const windsurfLocalAdapter = createWindsurfLocalAdapter(acpManager as unknown as AcpManagerLike);

export type { AcpManager };

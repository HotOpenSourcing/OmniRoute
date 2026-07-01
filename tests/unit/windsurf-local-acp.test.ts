import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  bootstrapWindsurfSession,
  type AcpManagerLike,
  type AcpSessionLike,
  type JsonRpcMessage,
} from "../../src/lib/acp/windsurfLocal.ts";

class FakeAcpManager extends EventEmitter implements AcpManagerLike {
  public readonly session: AcpSessionLike = {
    id: "fake-session",
    agentId: "windsurf",
    alive: true,
    stdoutBuffer: "",
    stderrBuffer: "",
    createdAt: new Date(),
  };

  public requests: JsonRpcMessage[] = [];
  public spawnCalled = false;
  public killCalled = false;

  constructor(
    private readonly handler: (request: JsonRpcMessage, manager: FakeAcpManager) => void | Promise<void>
  ) {
    super();
  }

  spawn(): AcpSessionLike {
    this.spawnCalled = true;
    return this.session;
  }

  sendInput(_sessionId: string, input: string): boolean {
    const message = JSON.parse(input.trim()) as JsonRpcMessage;
    this.requests.push(message);
    void Promise.resolve(this.handler(message, this));
    return true;
  }

  kill(): boolean {
    this.killCalled = true;
    return true;
  }

  emitStdout(message: unknown): void {
    const line = `${JSON.stringify(message)}\n`;
    this.session.stdoutBuffer += line;
    this.emit("stdout", { sessionId: this.session.id, data: line });
  }

  emitStderr(line: string): void {
    const chunk = `${line}\n`;
    this.session.stderrBuffer += chunk;
    this.emit("stderr", { sessionId: this.session.id, data: chunk });
  }
}

function makeResponse(id: number, result: Record<string, unknown>): JsonRpcMessage {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

test("bootstrapWindsurfSession returns models present in session/new", async () => {
  const manager = new FakeAcpManager((request, runtime) => {
    if (request.method === "initialize") {
      runtime.emitStdout(makeResponse(request.id as number, { protocolVersion: 1 }));
      return;
    }

    if (request.method === "authenticate") {
      runtime.emitStdout(makeResponse(request.id as number, {}));
      return;
    }

    if (request.method === "session/new") {
      runtime.emitStdout(
        makeResponse(request.id as number, {
          sessionId: "ws-123",
          modes: { currentModeId: "normal" },
          configOptions: [{ id: "mode", currentValue: "normal" }],
          models: {
            availableModels: [{ id: "gpt4o", name: "GPT-4o" }],
            currentModelId: "gpt4o",
          },
        })
      );
    }
  });

  const result = await bootstrapWindsurfSession({
    apiKey: "windsurf-api-key",
    apiServerUrl: "https://server.self-serve.windsurf.com",
    cwd: "C:/Users/amine/OmniRoute",
    binary: "fake-devin",
    manager,
  });

  assert.equal(result.sessionId, "ws-123");
  assert.deepEqual(result.models, {
    availableModels: [{ id: "gpt4o", name: "GPT-4o", owned_by: "windsurf" }],
    currentModelId: "gpt4o",
  });
  assert.deepEqual(result.modelDiscovery, {
    status: "present",
    source: "session/new",
  });
  assert.equal(result.diagnostics.rpc.requests.length, 3);
  assert.equal(result.diagnostics.rpc.responses.length, 3);
  assert.deepEqual(
    manager.requests.map((request) => request.method),
    ["initialize", "authenticate", "session/new"]
  );
});

test("bootstrapWindsurfSession enriches models via session/load when session/new omits them", async () => {
  const manager = new FakeAcpManager((request, runtime) => {
    if (request.method === "initialize") {
      runtime.emitStdout(makeResponse(request.id as number, { protocolVersion: 1 }));
      return;
    }

    if (request.method === "authenticate") {
      runtime.emitStdout(makeResponse(request.id as number, {}));
      return;
    }

    if (request.method === "session/new") {
      runtime.emitStdout({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "ws-234",
          update: { sessionUpdate: "available_commands_update", availableCommands: [] },
        },
      });
      runtime.emitStdout(
        makeResponse(request.id as number, {
          sessionId: "ws-234",
          modes: { currentModeId: "normal" },
          configOptions: [],
        })
      );
      return;
    }

    if (request.method === "session/load") {
      runtime.emitStdout(
        makeResponse(request.id as number, {
          models: {
            availableModels: [{ modelId: "claude-3-7-sonnet", displayName: "Claude 3.7 Sonnet" }],
            currentModelId: "claude-3-7-sonnet",
          },
        })
      );
    }
  });

  const result = await bootstrapWindsurfSession({
    apiKey: "windsurf-api-key",
    apiServerUrl: "https://server.self-serve.windsurf.com",
    cwd: "C:/Users/amine/OmniRoute",
    binary: "fake-devin",
    manager,
  });

  assert.deepEqual(result.models, {
    availableModels: [
      {
        id: "claude-3-7-sonnet",
        name: "Claude 3.7 Sonnet",
        owned_by: "windsurf",
      },
    ],
    currentModelId: "claude-3-7-sonnet",
  });
  assert.deepEqual(result.modelDiscovery, {
    status: "enriched",
    source: "session/load",
  });
  assert.equal(result.diagnostics.notifications.length, 1);
  assert.deepEqual(
    manager.requests.map((request) => request.method),
    ["initialize", "authenticate", "session/new", "session/load"]
  );
});

test("bootstrapWindsurfSession classifies invalid api key stderr as auth_failure when models remain missing", async () => {
  const manager = new FakeAcpManager((request, runtime) => {
    if (request.method === "initialize") {
      runtime.emitStdout(makeResponse(request.id as number, { protocolVersion: 1 }));
      return;
    }

    if (request.method === "authenticate") {
      runtime.emitStderr("Authentication required: invalid api key");
      runtime.emitStdout(makeResponse(request.id as number, {}));
      return;
    }

    if (request.method === "session/new") {
      runtime.emitStdout(makeResponse(request.id as number, { sessionId: "ws-auth" }));
      return;
    }

    if (request.method === "session/load" || request.method === "session/resume") {
      runtime.emitStdout(makeResponse(request.id as number, {}));
    }
  });

  const result = await bootstrapWindsurfSession({
    apiKey: "windsurf-api-key",
    apiServerUrl: "https://server.self-serve.windsurf.com",
    cwd: "C:/Users/amine/OmniRoute",
    binary: "fake-devin",
    manager,
  });

  assert.equal(result.models, undefined);
  assert.deepEqual(result.modelDiscovery, {
    status: "failed",
    source: "none",
    reason: "auth_failure",
  });
  assert.equal(result.diagnostics.stderr.some((line) => line.includes("invalid api key")), true);
  assert.deepEqual(
    manager.requests.map((request) => request.method),
    ["initialize", "authenticate", "session/new", "session/load", "session/resume"]
  );
});

test("bootstrapWindsurfSession classifies registry fetch stderr as registry_failure when models remain missing", async () => {
  const manager = new FakeAcpManager((request, runtime) => {
    if (request.method === "initialize") {
      runtime.emitStdout(makeResponse(request.id as number, { protocolVersion: 1 }));
      return;
    }

    if (request.method === "authenticate") {
      runtime.emitStderr("Failed to fetch model configs: upstream unavailable");
      runtime.emitStdout(makeResponse(request.id as number, {}));
      return;
    }

    if (request.method === "session/new") {
      runtime.emitStdout(makeResponse(request.id as number, { sessionId: "ws-registry" }));
      return;
    }

    if (request.method === "session/load" || request.method === "session/resume") {
      runtime.emitStdout(makeResponse(request.id as number, {}));
    }
  });

  const result = await bootstrapWindsurfSession({
    apiKey: "windsurf-api-key",
    apiServerUrl: "https://server.self-serve.windsurf.com",
    cwd: "C:/Users/amine/OmniRoute",
    binary: "fake-devin",
    manager,
  });

  assert.equal(result.models, undefined);
  assert.deepEqual(result.modelDiscovery, {
    status: "failed",
    source: "none",
    reason: "registry_failure",
  });
});

test("bootstrapWindsurfSession rejects encrypted credentials before ACP spawn", async () => {
  const manager = new FakeAcpManager(() => {});

  await assert.rejects(
    () =>
      bootstrapWindsurfSession({
        apiKey: "enc:v1:deadbeef",
        apiServerUrl: "https://server.self-serve.windsurf.com",
        cwd: "C:/Users/amine/OmniRoute",
        binary: "fake-devin",
        manager,
      }),
    /Encrypted credentials detected – missing STORAGE_ENCRYPTION_KEY/
  );

  assert.equal(manager.spawnCalled, false);
});

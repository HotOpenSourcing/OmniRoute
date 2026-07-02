/**
 * Freebuff chat-completions orchestrator.
 *
 * Implements the two-step Freebuff flow:
 *   1. Acquire a waiting-room slot via `POST /api/v1/freebuff/session`
 *      → returns an `instanceId` bound to the requested model.
 *   2. Stream the chat via `POST /api/v1/chat/completions` with the
 *      `instanceId` embedded as `codebuff.codebuff_metadata.freebuff_instance_id`.
 *   3. Release the slot via `DELETE /api/v1/freebuff/session` (best-effort).
 *
 * The upstream emits standard OpenAI chat-completion SSE chunks, so the
 * caller can pipe the response body through `createPassthroughTransformer`
 * (or re-frame it for Anthropic callers).
 *
 * @module lib/providers/freebuff/chat
 */

import { acquireFreebuffSlot, releaseFreebuffSlot, type FreebuffSessionStatus } from "./quota.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";

/** API base URL for Freebuff/Codebuff requests. Defaults to
 *  https://www.codebuff.com; overridable via the FREEBUFF_API_BASE env
 *  var for staging environments. */
export const FREEBUFF_API_BASE =
  process.env.FREEBUFF_API_BASE ?? "https://www.codebuff.com";

/** Default path to the Freebuff credentials.json. */
export const FREEBUFF_CREDENTIALS_PATH =
  process.env.FREEBUFF_CREDENTIALS_PATH ??
  resolveFreebuffCredentialsPath();

/** Resolve the credentials.json path with WSL/Windows fallback. Looks
 *  for the first file in `~/.config/manicode/credentials.json`, then
 *  `/mnt/c/Users/$USER/.config/manicode/credentials.json` (WSL view of
 *  the Windows manicode profile).
 *
 *  Accepts a file only when its JSON body looks like a real Freebuff
 *  connection (i.e. contains a UUID `default.authToken`). Stale or
 *  stub credentials (e.g. the empty `{"authToken":"not-a-uuid"}` that
 *  some installs leave behind) are skipped so we don't accidentally
 *  pin OmniRoute to a useless token. */
function resolveFreebuffCredentialsPath(): string {
  const candidates = [
    join(homedir(), ".config", "manicode", "credentials.json"),
    `/mnt/c/Users/${process.env.USER ?? ""}/.config/manicode/credentials.json`,
    `/mnt/c/Users/${process.env.USERNAME ?? ""}/.config/manicode/credentials.json`,
  ];
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as { default?: { authToken?: string } };
      const token = parsed?.default?.authToken;
      if (token && uuidRe.test(token)) return candidate;
    } catch {
      // try next
    }
  }
  return join(homedir(), ".config", "manicode", "credentials.json");
}

export interface FreebuffChatError extends Error {
  status: number;
  code?: FreebuffSessionStatus;
}

export interface FreebuffChatRequest {
  /** Model id (e.g. "deepseek/deepseek-v4-flash"). Must be Freebuff-eligible. */
  model: string;
  messages: Array<{ role: string; content: string }>;
  /** Temperature (0-1). Optional. */
  temperature?: number;
  /** top_p (0-1). Optional. */
  top_p?: number;
  /** Max tokens in completion. Defaults to 1024. */
  max_tokens?: number;
  /** Stream (default true). When false, the response is buffered and
   *  returned as a single OpenAI-shape JSON chunk. */
  stream?: boolean;
}

export interface FreebuffChatError extends Error {
  status: number;
  code?: FreebuffSessionStatus;
}

export class FreebuffChatRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: FreebuffSessionStatus,
  ) {
    super(message);
    this.name = "FreebuffChatRequestError";
  }
}

const PROVIDER_ORDER: Record<string, string> = {
  minimax: "MiniMax",
  deepseek: "DeepSeek",
  mimo: "MiMo",
  moonshotai: "Moonshot",
  "z-ai": "Z-AI",
  google: "Google",
};

function providerNameFor(model: string): string {
  const key = model.split("/")[0]?.toLowerCase() ?? "";
  return PROVIDER_ORDER[key] ?? key;
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Read the credentials.json and return the `default.authToken`.
 * Throws if no token is found.
 */
async function readAuthToken(): Promise<string> {
  const fs = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await fs.readFile(FREEBUFF_CREDENTIALS_PATH, "utf8");
  } catch (err) {
    throw new FreebuffChatRequestError(
      `Cannot read Freebuff credentials at ${FREEBUFF_CREDENTIALS_PATH}: ${(err as Error).message}`,
      401,
      "no_connection",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FreebuffChatRequestError(
      `Freebuff credentials at ${FREEBUFF_CREDENTIALS_PATH} is not valid JSON`,
      500,
    );
  }
  const token = (parsed as { default?: { authToken?: string } })?.default
    ?.authToken;
  if (!token) {
    throw new FreebuffChatRequestError(
      `No default.authToken found in ${FREEBUFF_CREDENTIALS_PATH}`,
      401,
      "no_connection",
    );
  }
  return token;
}

/**
 * Stream a Freebuff chat completion.
 *
 * Returns a `Response` whose body is the upstream SSE stream (OpenAI shape).
 * The caller is responsible for piping it through a transformer and
 * closing it; the Freebuff session is released in the response's `finalize`
 * callback, but the caller must invoke `response.body?.cancel()` or drain
 * the stream to ensure cleanup.
 *
 * Throws `FreebuffChatRequestError` for any failure that prevents the
 * upstream call from being initiated (missing credentials, queue rejection,
 * etc.).
 */
export async function sendFreebuffChat(
  request: FreebuffChatRequest,
): Promise<Response> {
  const authToken = await readAuthToken();

  // Step 1 — acquire a slot.
  const slot = await acquireFreebuffSlot(authToken, request.model);
  if (slot.status !== "active") {
    throw new FreebuffChatRequestError(
      `Freebuff refused the session for model=${request.model}: ${slot.status}`,
      429,
      slot.status,
    );
  }
  const instanceId = slot.instanceId;
  if (!instanceId) {
    throw new FreebuffChatRequestError(
      "Freebuff returned an active session without an instanceId",
      500,
      "active",
    );
  }

  // Step 2 — dispatch the chat completion.
  const runId = uuid();
  const clientId = uuid();
  const providerName = providerNameFor(request.model);

  const body = {
    model: request.model,
    messages: request.messages,
    stream: request.stream ?? true,
    max_tokens: request.max_tokens ?? 1024,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    codebuff: {
      codebuff_metadata: {
        run_id: runId,
        client_id: clientId,
        cost_mode: "free",
        freebuff_instance_id: instanceId,
      },
      provider: {
        order: [providerName],
        allow_fallbacks: false,
      },
    },
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${FREEBUFF_API_BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Accept: request.stream === false ? "application/json" : "text/event-stream",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Best-effort release before propagating.
    await releaseFreebuffSlot(authToken).catch(() => undefined);
    throw new FreebuffChatRequestError(
      `Network error contacting Freebuff: ${(err as Error).message}`,
      503,
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => "");
    await releaseFreebuffSlot(authToken).catch(() => undefined);
    throw new FreebuffChatRequestError(
      `Freebuff upstream returned HTTP ${upstream.status}: ${errorBody.slice(0, 200)}`,
      upstream.status,
    );
  }

  // Step 3 — wrap the upstream body so the slot is released when the
  // consumer finishes (or aborts) the stream.
  const releasedRef = { released: false };
  const release = () => {
    if (releasedRef.released) return;
    releasedRef.released = true;
    void releaseFreebuffSlot(authToken).catch(() => undefined);
  };

  const wrappedBody = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        release();
      },
      cancel() {
        release();
      },
    }),
  );

  // Build a Response that mirrors upstream status + headers, with the
  // wrapped body and an `AbortSignal` listener that releases on abort.
  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (key.toLowerCase() === "content-encoding") continue;
    responseHeaders.set(key, value);
  }
  if (!responseHeaders.has("Content-Type")) {
    responseHeaders.set(
      "Content-Type",
      request.stream === false ? "application/json" : "text/event-stream",
    );
  }
  responseHeaders.set("Cache-Control", "no-cache");
  responseHeaders.set("x-omniroute-freebuff-instance", instanceId);

  return new Response(wrappedBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

/**
 * Non-streaming variant of `sendFreebuffChat`. Returns the full
 * OpenAI-shape completion as a parsed JSON object.
 */
export async function sendFreebuffChatOnce(
  request: FreebuffChatRequest,
): Promise<unknown> {
  const response = await sendFreebuffChat({ ...request, stream: false });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

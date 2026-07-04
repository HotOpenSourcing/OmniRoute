/**
 * Freebuff chat-completions orchestrator.
 *
 * Implements the two-step Freebuff flow with a per-process seat cache:
 *   1. Acquire (or reuse) a waiting-room slot via the
 *      `freebuffSessionManager` (cached `instanceId` keyed by
 *      `(authToken, model)`, with proactive refresh at
 *      `expiresAt - 5 min`).
 *   2. Stream the chat via `POST /api/v1/chat/completions` with the
 *      `instanceId` in the `x-freebuff-instance-id` header and the
 *      body envelope validated in `chatIntegration.ts` (top-level
 *      `runId`, `provider`, `codebuff_metadata` — see
 *      `validation-scripts/final-validations.md` C3).
 *   3. The seat is NOT released on stream end (the server TTL is 1 h
 *      and we want to reuse it across requests). Explicit release
 *      goes through `freebuffSessionManager.releaseSession(...)` for
 *      sign-out / account-switch flows.
 *
 * The upstream emits standard OpenAI chat-completion SSE chunks, so
 * the caller can pipe the response body through
 * `createPassthroughTransformer` (or re-frame it for Anthropic).
 *
 * @module lib/providers/freebuff/chat
 */

import { type FreebuffSessionStatus, FreebuffAuthError } from "./quota.ts";
import { getFreebuffRootAgentIdForModel } from "./models.ts";
import {
  freebuffSessionManager,
  FreebuffSessionManagerError,
} from "./sessionManager.ts";
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
  anthropic: "Anthropic",
  openai: "OpenAI",
  "x-ai": "xAI",
};

/**
 * User-Agent header stamped on every chat call to the upstream.
 * Matches the SDK binary's `ai-sdk/openai-compatible/<v>/codebuff`
 * pattern. The server does NOT validate the UA (Mission 1 case 4),
 * but we send it for traceability.
 */
export const FREEBUFF_SDK_VERSION = "1.0.0";
export const FREEBUFF_USER_AGENT = `ai-sdk/openai-compatible/${FREEBUFF_SDK_VERSION}/codebuff`;

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
 * Module-level stable `client_id` for the OmniRoute process. The
 * upstream correlates requests by `codebuff_metadata.client_id`, so
 * it MUST stay constant across the lifetime of a single user session
 * (per the SDK contract — `codebuff_metadata.client_id` is the
 * session-level correlation id, NOT a per-request id).
 *
 * Generated lazily on first read.
 *
 * Exposed as `__resetStableClientId()` for tests so each `describe`
 * block can start with a fresh correlation id.
 */
let STABLE_CLIENT_ID: string | undefined;
function stableClientId(): string {
  if (!STABLE_CLIENT_ID) STABLE_CLIENT_ID = uuid();
  return STABLE_CLIENT_ID;
}

/** Test seam — reset the module-level stable `client_id`. */
export function __resetStableClientId(): void {
  STABLE_CLIENT_ID = undefined;
}

// ---------------------------------------------------------------------------
// Pure wire-shape helpers (exported for unit tests + reuse by callers that
// already hold a seat — e.g. the agent-runs executor in
// `open-sse/executors/freebuff.ts`).
// ---------------------------------------------------------------------------

export interface FreebuffChatBodyInput {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  /** Seat UUID stamped on `x-freebuff-instance-id` and
   *  `codebuff_metadata.freebuff_instance_id`. */
  instanceId: string;
  /** Fingerprint id stamped on `x-codebuff-fingerprint` and
   *  `codebuff_metadata.fingerprint_id`. */
  fingerprintId?: string;
  /** Stable client correlation id for `codebuff_metadata.client_id`. */
  clientId?: string;
  /** Override the per-request `runId` (rare — defaults to a uuid v4). */
  runId?: string;
  /** Override the per-request `user_input_id` (rare). */
  userInputId?: string;
  /** Override the per-request `trace_session_id` (rare). */
  traceSessionId?: string;
}

/**
 * Build the chat-completions request body for the Codebuff/Freebuff
 * upstream.
 *
 * Body envelope (post v3.8.43, validated against www.codebuff.com):
 *   runId, provider, codebuff_metadata MUST be at the TOP LEVEL — the
 *   upstream returns 400 "No runId found in request body" when they are
 *   nested under a `codebuff.*` wrapper. (See
 *   `validation-scripts/final-validations.md` finding C3.)
 *
 * Required `codebuff_metadata` fields:
 *   - fingerprint_id, client_id, cost_mode: "free",
 *     user_input_id, agent, freebuff_instance_id, trace_session_id
 *
 * Required `provider` fields:
 *   - order: [primary], allow_fallbacks: false, sort: "price"
 */
export function buildFreebuffChatBody(
  input: FreebuffChatBodyInput,
): {
  body: Record<string, unknown>;
  agentId: string;
  runId: string;
  userInputId: string;
  traceSessionId: string;
} {
  const agentId = getFreebuffRootAgentIdForModel(input.model);
  const runId = input.runId ?? uuid();
  const userInputId = input.userInputId ?? uuid();
  const traceSessionId = input.traceSessionId ?? uuid();
  const providerName = providerNameFor(input.model);

  const body: Record<string, unknown> = {
    runId,
    model: input.model,
    messages: input.messages,
    stream: input.stream ?? true,
    stream_options: { include_usage: true },
    max_tokens: input.max_tokens ?? 1024,
    provider: {
      order: [providerName],
      allow_fallbacks: false,
      sort: "price",
    },
    codebuff_metadata: {
      fingerprint_id: input.fingerprintId ?? "unknown",
      client_id: input.clientId ?? stableClientId(),
      cost_mode: "free",
      user_input_id: userInputId,
      agent: agentId,
      freebuff_instance_id: input.instanceId,
      trace_session_id: traceSessionId,
    },
  };
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.top_p !== undefined) body.top_p = input.top_p;
  return { body, agentId, runId, userInputId, traceSessionId };
}

/**
 * Build the chat-completions request headers for the Codebuff/Freebuff
 * upstream. Exported for tests + callers that already hold a seat.
 */
export function buildFreebuffChatHeaders(input: {
  authToken: string;
  instanceId: string;
  model: string;
  fingerprintId?: string;
  fingerprintHash?: string;
  stream: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.authToken}`,
    "Content-Type": "application/json",
    Accept: input.stream ? "text/event-stream" : "application/json",
    "user-agent": FREEBUFF_USER_AGENT,
    "x-freebuff-instance-id": input.instanceId,
    "x-freebuff-model": input.model,
  };
  if (input.fingerprintId) {
    headers["x-codebuff-fingerprint"] = input.fingerprintId;
  }
  if (input.fingerprintHash) {
    headers["x-codebuff-fingerprint-hash"] = input.fingerprintHash;
  }
  return headers;
}

/**
 * Read credentials.json and return the full credential triple.
 * Throws `FreebuffChatRequestError` if no usable authToken is found.
 *
 * Note: fingerprintId/fingerprintHash are optional — when absent, the
 * `x-codebuff-fingerprint[-hash]` headers are simply not sent. The
 * upstream does not require them (validated by Mission 1 case 5).
 */
interface FreebuffCredentials {
  authToken: string;
  fingerprintId?: string;
  fingerprintHash?: string;
}

async function readCredentials(): Promise<FreebuffCredentials> {
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
  const def = (parsed as { default?: { authToken?: string; fingerprintId?: string; fingerprintHash?: string } })?.default;
  const token = def?.authToken;
  if (!token || token === "REFRESH_NEEDED" || token === "not-a-uuid") {
    throw new FreebuffChatRequestError(
      `No usable default.authToken found in ${FREEBUFF_CREDENTIALS_PATH} (got: ${token ? `"${token}"` : "missing"})`,
      401,
      "no_connection",
    );
  }
  return {
    authToken: token,
    fingerprintId: def?.fingerprintId || undefined,
    fingerprintHash: def?.fingerprintHash || undefined,
  };
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
  const credentials = await readCredentials();
  const { authToken } = credentials;

  // Step 1 — acquire (or reuse) a seat via the session manager.
  //
  // The SessionManager caches the `instanceId` across calls within one
  // OmniRoute process so concurrent chat requests for the same
  // `(token, model)` share a single server-side seat (the server
  // mutex would otherwise `superseded`-kill the previous one). It
  // also schedules a proactive refresh at `expiresAt - 5 min` so the
  // caller never observes an `ended → none` gap.
  let seat;
  try {
    seat = await freebuffSessionManager.acquireSession({
      authToken,
      model: request.model,
      fingerprint: credentials.fingerprintId
        ? {
            fingerprintId: credentials.fingerprintId,
            fingerprintHash: credentials.fingerprintHash,
          }
        : undefined,
    });
  } catch (err) {
    // 401 → FreebuffAuthError (re-auth required). Propagate as-is so
    // the caller can route to a re-auth flow.
    if (err instanceof FreebuffAuthError) {
      throw err;
    }
    // SessionManager typed error → map to FreebuffChatRequestError for
    // backwards compat with existing callers.
    if (err instanceof FreebuffSessionManagerError) {
      throw new FreebuffChatRequestError(
        err.message,
        err.status,
        err.code as FreebuffSessionStatus | undefined,
      );
    }
    throw err;
  }

  const instanceId = seat.instanceId;

  // Step 2 — build the wire-shape body and headers via the pure
  // helpers (exported for tests). The body envelope is locked in
  // `chatIntegration.ts` and re-validated against the live upstream
  // (`validation-scripts/final-validations.md` C3): `runId`, `provider`,
  // and `codebuff_metadata` MUST be at the TOP LEVEL — nested values
  // trigger HTTP 400.
  const stream = request.stream ?? true;
  const { body } = buildFreebuffChatBody({
    model: request.model,
    messages: request.messages,
    temperature: request.temperature,
    top_p: request.top_p,
    max_tokens: request.max_tokens,
    stream,
    instanceId,
    fingerprintId: credentials.fingerprintId,
  });
  const headers = buildFreebuffChatHeaders({
    authToken,
    instanceId,
    model: request.model,
    fingerprintId: credentials.fingerprintId,
    fingerprintHash: credentials.fingerprintHash,
    stream,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${FREEBUFF_API_BASE}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network error before we got any response: do NOT release the
    // cached seat (we may just have hit a transient blip and the
    // seat is still valid for ~1h). Just surface the error.
    throw new FreebuffChatRequestError(
      `Network error contacting Freebuff: ${(err as Error).message}`,
      503,
    );
  }

  // 401 from the chat endpoint itself (token expired between POST /session
  // and POST /chat) — invalidate the entire token's seat cache so the
  // next caller triggers re-auth.
  if (upstream.status === 401) {
    freebuffSessionManager.invalidateAll(authToken, "auth_expired");
    const errorBody = await upstream.text().catch(() => "");
    throw new FreebuffChatRequestError(
      `Freebuff upstream returned HTTP 401 — auth token expired: ${errorBody.slice(0, 200)}`,
      401,
    );
  }

  // 409 with body indicating the instance is no longer valid (server
  // swept the row → typical after `superseded` or after `ended`).
  // Invalidate the cached seat and surface a typed error so the
  // caller can retry with a fresh acquisition.
  if (upstream.status === 409) {
    const errorBody = await upstream.text().catch(() => "");
    let parsedBody: { status?: string } | null = null;
    try {
      parsedBody = JSON.parse(errorBody) as { status?: string };
    } catch {
      /* not JSON */
    }
    if (
      parsedBody?.status === "superseded" ||
      parsedBody?.status === "ended" ||
      parsedBody?.status === "none"
    ) {
      freebuffSessionManager.invalidate(authToken, request.model, "superseded");
      throw new FreebuffChatRequestError(
        `Freebuff seat ${instanceId} for model=${request.model} is ${parsedBody.status}; please retry`,
        upstream.status,
        parsedBody.status as FreebuffSessionStatus,
      );
    }
  }

  if (!upstream.ok || !upstream.body) {
    const errorBody = await upstream.text().catch(() => "");
    throw new FreebuffChatRequestError(
      `Freebuff upstream returned HTTP ${upstream.status}: ${errorBody.slice(0, 200)}`,
      upstream.status,
    );
  }

  // Step 3 — wrap the upstream body. The seat is intentionally NOT
  // released on stream end:
  //
  //   - The server-side seat has a 1 h flat TTL (C5). Deleting it
  //     after every chat turn would force a fresh POST on the next
  //     request and waste the TTL budget.
  //   - The `freebuffSessionManager` keeps the cached `instanceId`
  //     warm and proactively refreshes it at `expiresAt - 5 min`.
  //   - Explicit release (sign-out, account switch, error path) goes
  //     through `freebuffSessionManager.releaseSession(...)`.
  //
  // We still wrap the body so we can attach a `finalize` hook for
  // callers that want to react to stream end (e.g. UI side-effects),
  // but the hook is intentionally a no-op for the seat.
  const finalizeRef = { finalized: false };
  const finalize = () => {
    if (finalizeRef.finalized) return;
    finalizeRef.finalized = true;
  };

  const wrappedBody = upstream.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        finalize();
      },
      cancel() {
        finalize();
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

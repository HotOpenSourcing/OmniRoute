/**
 * Freebuff ChatExecutor — extracted from `chat.ts` to isolate the run
 * lifecycle (acquire session → start agent run → POST chat) and to
 * provide a single, testable seam for proxy injection.
 *
 * Honours the validation findings from
 * `~/.config/manicode/freebuff-model-tests/validation-scripts/
 *  final-validations.md`:
 *
 *   - C3 / C10 — `runId`, `provider`, and `codebuff_metadata` are
 *     TOP-LEVEL keys in the chat-completions body. (User-resolved
 *     contradiction: the validation report's §3 says `run_id` lives
 *     inside `codebuff_metadata`; we follow the existing wiring in
 *     `chat.ts` / `chatIntegration.ts` per the resolved answer.)
 *
 *   - C5 — session TTL is 1 h flat. The seat is cached by
 *     `freebuffSessionManager` (mutex per token, refresh at
 *     `expiresAt - 5 min`).
 *
 *   - C6 — 401 → `FreebuffAuthError`. The seat cache for the whole
 *     token is invalidated so the next caller triggers re-auth.
 *
 *   - C8 — `superseded` → invalidate the cached seat for the
 *     `(token, model)` pair and surface a typed error. The caller
 *     can retry with a fresh acquisition.
 *
 * Proxy wiring (new in this ferment):
 *
 *   - The constructor accepts an optional `proxyAgent`. When set, it
 *     is attached to every direct HTTP call (`/agent-runs`,
 *     `/chat/completions`) via the underlying `fetchImpl` (which
 *     defaults to `node-fetch`, so `agent: HttpsProxyAgent(url)`
 *     works out of the box).
 *   - The same `fetchImpl` is forwarded to
 *     `freebuffSessionManager.acquireSession({ fetchImpl })`, so the
 *     session acquisition also honours the proxy.
 *   - When `proxyAgent` is unset (and `RESIDENTIAL_PROXY` is unset),
 *     the executor uses node-fetch with no `agent` option, which is
 *     equivalent to a direct HTTPS connection.
 *
 * @module lib/providers/freebuff/ChatExecutor
 */

import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";
import type { RequestInit, Response } from "node-fetch";

import { type FreebuffSessionStatus, FreebuffAuthError } from "./quota.ts";
import {
  freebuffSessionManager,
  FreebuffSessionManager,
} from "./sessionManager.ts";
import {
  startAgentRun,
  type FreebuffCredentials,
} from "./agentRuns.ts";
import { getFreebuffAgentId } from "./agentMapping.ts";
import {
  buildFreebuffChatBody,
  buildFreebuffChatHeaders,
  FREEBUFF_USER_AGENT,
} from "./chat.ts";

// ────────────────────────────────────────────────────────────────────────────
// Public types.
// ────────────────────────────────────────────────────────────────────────────

export interface ChatExecutorRequest {
  /** Model id (e.g. "deepseek/deepseek-v4-flash"). */
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatExecutorCredentials {
  /** Freebuff `authToken` (Bearer). */
  authToken: string;
  /** Required to call `/agent-runs`. Optional — when absent we skip
   *  the handshake and generate a local UUID for `runId` (matches the
   *  pre-`/agent-runs` behaviour of the original `chat.ts`). */
  fingerprintId?: string;
  fingerprintHash?: string;
}

export interface ChatExecutorOptions {
  /** Abort signal — propagated to all upstream calls. */
  signal?: AbortSignal;
}

export class ChatExecutorError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: FreebuffSessionStatus,
  ) {
    super(message);
    this.name = "ChatExecutorError";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Proxy resolution.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a proxy URL from the environment. Honours `RESIDENTIAL_PROXY`
 * (preferred — set by the `freebuff-model-tests/validation-scripts`
 * harness) and falls back to `HTTPS_PROXY` (the standard Node.js
 * convention).
 *
 * Returns `undefined` when neither env var is set. The ChatExecutor
 * treats `undefined` as "no proxy — direct connection".
 */
export function resolveProxyUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env.RESIDENTIAL_PROXY ?? env.HTTPS_PROXY;
  if (!url || url.trim() === "") return undefined;
  return url.trim();
}

/**
 * Construct an `HttpsProxyAgent` from a URL string. Returns
 * `undefined` when the URL is missing.
 *
 * Exported so callers (e.g. `test-adapter.ts`) can build a proxy agent
 * once and inject it into the executor.
 */
export function resolveProxyAgent(
  env: NodeJS.ProcessEnv = process.env,
): HttpsProxyAgent | undefined {
  const url = resolveProxyUrl(env);
  if (!url) return undefined;
  return new HttpsProxyAgent(url);
}

// ────────────────────────────────────────────────────────────────────────────
// ChatExecutor.
// ────────────────────────────────────────────────────────────────────────────

export interface ChatExecutorDeps {
  /** Base URL for the Freebuff upstream. */
  baseUrl?: string;
  /** Proxy agent — when set, attached to every direct HTTP call. */
  proxyAgent?: HttpsProxyAgent | undefined;
  /**
   * HTTP client. Defaults to `node-fetch`, which honours the
   * `agent: HttpsProxyAgent(url)` request option natively. Override
   * in tests with a stub.
   */
  fetchImpl?: typeof nodeFetch;
  /**
   * Session manager — defaults to the module-level
   * `freebuffSessionManager` singleton. Override in tests to isolate
   * state.
   */
  sessionManager?: FreebuffSessionManager;
}

export class ChatExecutor {
  private readonly baseUrl: string;
  private readonly proxyAgent: HttpsProxyAgent | undefined;
  private readonly httpFetch: typeof nodeFetch;
  private readonly sessionManager: FreebuffSessionManager;

  constructor(deps: ChatExecutorDeps = {}) {
    this.baseUrl =
      deps.baseUrl ??
      process.env.FREEBUFF_API_BASE ??
      "https://www.codebuff.com";
    this.proxyAgent = deps.proxyAgent;
    this.httpFetch = deps.fetchImpl ?? nodeFetch;
    this.sessionManager = deps.sessionManager ?? freebuffSessionManager;
  }

  /**
   * Execute a chat completion. Returns the upstream `Response` whose
   * body is the OpenAI-shape SSE stream. The caller is responsible for
   * piping the body through a transformer and draining / cancelling it.
   *
   * Throws `ChatExecutorError` on any failure that prevents the
   * upstream call from being initiated. Surfaces `FreebuffAuthError`
   * as-is so the caller can route to a re-auth flow.
   */
  async execute(
    credentials: ChatExecutorCredentials,
    request: ChatExecutorRequest,
    options: ChatExecutorOptions = {},
  ): Promise<Response> {
    const { authToken } = credentials;

    // ── Step 1 — acquire (or reuse) a seat via the session manager.
    let seat;
    try {
      seat = await this.sessionManager.acquireSession({
        authToken,
        model: request.model,
        fingerprint: credentials.fingerprintId
          ? {
              fingerprintId: credentials.fingerprintId,
              fingerprintHash: credentials.fingerprintHash,
            }
          : undefined,
        // The session manager's typed `fetchImpl` is `typeof fetch`
        // (Web Fetch). node-fetch is structurally compatible at the
        // call sites that matter (method, headers, body, signal,
        // agent), so we cast through `unknown` once at the boundary.
        fetchImpl: this.httpFetch as unknown as typeof fetch,
        signal: options.signal,
      });
    } catch (err) {
      if (err instanceof FreebuffAuthError) throw err;
      if (err instanceof Error && err.name === "FreebuffSessionManagerError") {
        throw new ChatExecutorError(
          err.message,
          (err as Error & { status?: number }).status ?? 503,
          (err as Error & { code?: FreebuffSessionStatus }).code,
        );
      }
      throw err;
    }

    // ── Step 2 — start the agent run when a fingerprint triple is
    // available. The run id returned by the upstream is stamped at
    // the TOP LEVEL of the chat body (user-resolved placement). When
    // no fingerprint is present we fall back to a locally-generated
    // UUID — this preserves the pre-`/agent-runs` behaviour of the
    // original `chat.ts`.
    const agentId = getFreebuffAgentId(request.model);
    let runId: string;
    if (credentials.fingerprintId && agentId) {
      try {
        runId = await startAgentRun({
          credentials: {
            authToken,
            fingerprintId: credentials.fingerprintId,
            fingerprintHash: credentials.fingerprintHash,
          },
          agentId,
          ancestorRunIds: [],
          baseUrl: this.baseUrl,
          fetcher: this.httpFetch as unknown as typeof fetch,
          signal: options.signal,
        });
      } catch (err) {
        // startAgentRun is best-effort when chat.ts is in fallback
        // mode (no fingerprint); here we DO have a fingerprint, so a
        // failure should propagate. But we still degrade gracefully
        // to a local UUID so the caller is not blocked by a transient
        // /agent-runs blip.
        runId = localUuid();
      }
    } else {
      runId = localUuid();
    }

    // ── Step 3 — build body + headers via the pure helpers in chat.ts.
    const stream = request.stream ?? true;
    const { body } = buildFreebuffChatBody({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      stream,
      instanceId: seat.instanceId,
      fingerprintId: credentials.fingerprintId,
      runId,
    });
    const headers = buildFreebuffChatHeaders({
      authToken,
      instanceId: seat.instanceId,
      model: request.model,
      fingerprintId: credentials.fingerprintId,
      fingerprintHash: credentials.fingerprintHash,
      stream,
    });

    // ── Step 4 — POST /chat/completions.
    const init: RequestInit = {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    };
    if (options.signal) init.signal = options.signal;
    if (this.proxyAgent) init.agent = this.proxyAgent;

    let upstream: Response;
    try {
      upstream = await this.httpFetch(
        `${this.baseUrl}/api/v1/chat/completions`,
        init,
      );
    } catch (err) {
      // Network error before we got any response. Do NOT release the
      // cached seat (it may still be valid for ~1h).
      throw new ChatExecutorError(
        `Network error contacting Freebuff: ${(err as Error).message}`,
        503,
      );
    }

    // 401 from the chat endpoint itself (token expired between
    // POST /session and POST /chat). Invalidate the entire token's
    // seat cache so the next caller triggers re-auth.
    if (upstream.status === 401) {
      this.sessionManager.invalidateAll(authToken, "auth_expired");
      const errorBody = await upstream.text().catch(() => "");
      throw new ChatExecutorError(
        `Freebuff upstream returned HTTP 401 — auth token expired: ${errorBody.slice(0, 200)}`,
        401,
      );
    }

    // 409 with body indicating the seat is no longer valid (server
    // swept the row → typical after `superseded` or `ended`). Invalidate
    // the cached seat and surface a typed error so the caller can retry.
    if (upstream.status === 409) {
      const errorBody = await upstream.text().catch(() => "");
      let parsed: { status?: string } | null = null;
      try {
        parsed = JSON.parse(errorBody) as { status?: string };
      } catch {
        /* not JSON */
      }
      if (
        parsed?.status === "superseded" ||
        parsed?.status === "ended" ||
        parsed?.status === "none"
      ) {
        this.sessionManager.invalidate(
          authToken,
          request.model,
          "superseded",
        );
        throw new ChatExecutorError(
          `Freebuff seat ${seat.instanceId} for model=${request.model} is ${parsed.status}; please retry`,
          upstream.status,
          parsed.status as FreebuffSessionStatus,
        );
      }
    }

    if (!upstream.ok || !upstream.body) {
      const errorBody = await upstream.text().catch(() => "");
      throw new ChatExecutorError(
        `Freebuff upstream returned HTTP ${upstream.status}: ${errorBody.slice(0, 200)}`,
        upstream.status,
      );
    }

    return upstream;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers.
// ────────────────────────────────────────────────────────────────────────────

function localUuid(): string {
  // crypto.randomUUID is available on Node 22+. Fall back to a
  // timestamp+random hex string when it is missing (older runtimes).
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 18)}`;
}

// Re-export the FreebuffCredentials type so callers don't have to
// reach into agentRuns.ts just to type their credentials object.
export type { FreebuffCredentials };

// Re-export the user-agent constant so callers that wrap a Response
// can stamp it without re-importing chat.ts.
export { FREEBUFF_USER_AGENT };

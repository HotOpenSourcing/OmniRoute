/**
 * Freebuff chat-stream integration.
 *
 * Bridges the Codebuff/Freebuff backend and the OmniRoute SSE dispatcher
 * (`@/sse/handlers/chat`). The wire format is the **top-level** envelope
 * captured in `~/.config/manicode/freebuff-model-tests/phase4-deliverables/
 * 00-PROTOCOL-SPEC.md` (see also `final-validations.md` for the runtime
 * validation). Older revisions of this file nested everything under
 * `codebuff.codebuff_metadata` / `codebuff.provider`; the upstream now
 * rejects that shape with HTTP 400 (`No runId found in request body`,
 * `No provider found`, …) — see `sendToCodebuff` below.
 *
 * Pipeline:
 *   1. Parse + validate the incoming body (OpenAI-compatible shape).
 *   2. Resolve the Freebuff connection (authToken + fingerprintId +
 *      fingerprintHash) for the caller from the OmniRoute connection store.
 *   3. POST the body — with **top-level** `runId`, `provider`,
 *      `codebuff_metadata` and the required `x-codebuff-fingerprint[-hash]`
 *      headers — to `<WEBSITE_URL>/api/v1/chat/completions`. The same
 *      endpoint serves both OpenAI-shaped and Anthropic-shaped requests.
 *   4. Pipe the upstream SSE stream through the OpenAI/Anthropic
 *      transformer so the wire format matches the caller's expectation.
 *
 * @module lib/providers/freebuff/chatIntegration
 */

import { z } from "zod";
import * as cryptoModule from "node:crypto";
import {
  createTransformer,
  type TransformerFormat,
} from "./stream/index.ts";
import { resolveFreebuffBaseUrl } from "./base.ts";
import {
  ensureFreebuffSeat,
  invalidateFreebuffSeat,
  withFreebuffChatLock,
} from "./seatCache.ts";
import {
  buildFreebuffHeaders,
  finishAgentRun,
  startAgentRun,
  type FreebuffCredentials,
} from "./agentRuns.ts";
import { getFreebuffAgentId } from "./agentMapping.ts";

/**
 * Version string stamped on the `user-agent` header sent to the
 * Codebuff/Freebuff upstream. Matches the `ai-sdk/openai-compatible/<v>/codebuff`
 * pattern observed in the CLI (rapport §8.2). Bump when the wire format
 * changes.
 */
export const FREEBUFF_SDK_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Public types — the contract `handleChat` must respect.
// ---------------------------------------------------------------------------

export const freebuffChatRequestSchema = z.object({
  /** Either a Freebuff model id (e.g. "mimo/mimo-v2.5") or any alias. */
  model: z.string().min(1),
  messages: z.array(z.unknown()),
  stream: z.boolean().optional().default(false),
  /** Optional client-side toggles consumed by the transformer. */
  include_subagent_output: z.boolean().optional(),
  /** Free-form passthrough for tools, temperature, etc. */
});

export type FreebuffChatRequest = z.infer<typeof freebuffChatRequestSchema>;

export type FreebuffChatFormat = TransformerFormat;

export interface FreebuffChatOptions {
  /**
   * Which SSE wire format the caller expects on the wire. Set to
   * `"anthropic"` for the `/v1/messages` handler and `"openai"` for
   * `/v1/chat/completions`. Defaults to `"openai"`.
   */
  format?: FreebuffChatFormat;
  /**
   * Authenticated user identifier — used to look up the persisted
   * connection (authToken + fingerprintId).
   */
  userId: string;
  /**
   * Optional connection id (preferred over `userId` when supplied).
   */
  connectionId?: string;
  /**
   * Stable client identifier stamped on `codebuff.codebuff_metadata.client_id`.
   * Should remain constant across the lifetime of a single user session so
   * the upstream backend can correlate requests. Defaults to a fresh UUID
   * per request if omitted.
   */
  sessionId?: string;
  /**
   * Freebuff session UUID returned by `POST /api/v1/freebuff/session`.
   * Stamped on `codebuff.codebuff_metadata.freebuff_instance_id` so the
   * upstream links the chat request to the active queue seat.
   */
  instanceId?: string;
  /**
   * Stamped on `codebuff.provider.allow_fallbacks`. Defaults to `false`
   * because Freebuff models are explicitly defined and the backend enforces
   * the `FREE_MODE_AGENT_MODELS` allowlist.
   */
  allowFallbacks?: boolean;
  /**
   * Optional provider routing order, stamped on `codebuff.provider.order`.
   * When omitted, the upstream backend decides based on the model.
   */
  providerOrder?: string[];
  /**
   * Optional abort signal — typically the request `signal`.
   */
  signal?: AbortSignal;
  /**
   * Override fetch (used by tests).
   */
  fetchImpl?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/**
 * Returns `"anthropic"` if the request originated from `/v1/messages`,
 * otherwise `"openai"`. Detected from the `format` option — never from
 * the body, since OpenAI-shaped clients also send `messages`.
 */
export function selectTransformerFormat(
  options: FreebuffChatOptions,
): FreebuffChatFormat {
  return options.format ?? "openai";
}

/**
 * Build the URL of the upstream Codebuff chat-completions endpoint.
 *
 * Both OpenAI-shaped and Anthropic-shaped requests hit the same endpoint
 * — the upstream backend (rapport §8.2) routes on `model` and the
 * `codebuff.codebuff_metadata.cost_mode` flag, not on a separate path.
 */
export function buildCodebuffUpstreamUrl(_format: FreebuffChatFormat): string {
  const base = resolveFreebuffBaseUrl().replace(/\/$/, "");
  return `${base}/api/v1/chat/completions`;
}

/**
 * Wraps an upstream Codebuff byte stream with the appropriate SSE
 * transformer. Pure — does no I/O.
 */
export function pipeStreamThroughTransformer(
  upstream: ReadableStream<Uint8Array>,
  format: FreebuffChatFormat,
  model: string,
  includeSubagentOutput = false,
): ReadableStream<Uint8Array> {
  return upstream.pipeThrough(
    createTransformer(format, {
      model,
      includeSubagentOutput,
    }),
  );
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Load the Freebuff credentials for a given connection / user from the
 * OmniRoute connection store.
 */
async function loadFreebuffCredentials(
  options: FreebuffChatOptions,
): Promise<{ authToken: string; fingerprintId: string; fingerprintHash?: string } | null> {
  const { getProviderConnectionById, getProviderConnections } = await import(
    "@/lib/localDb"
  );
  const { freebuffConnectionSchema } = await import(
    "@/shared/schemas/providers/freebuff"
  );

  if (options.connectionId) {
    const row = await getProviderConnectionById(options.connectionId);
    if (row && row.provider === "freebuff") {
      try {
        const parsed = freebuffConnectionSchema.safeParse(
          JSON.parse(row.apiKey ?? "{}"),
        );
        if (parsed.success) {
          return {
            authToken: parsed.data.authToken,
            fingerprintId: parsed.data.fingerprintId,
            fingerprintHash: parsed.data.fingerprintHash,
          };
        }
      } catch {
        // fall through
      }
    }
  }

  const rows = (await getProviderConnections({ provider: "freebuff" })) as Array<{
    id: string;
    provider: string;
    apiKey?: string;
  }>;
  for (const row of rows) {
    if (row.provider !== "freebuff") continue;
    try {
      const parsed = freebuffConnectionSchema.safeParse(
        JSON.parse(row.apiKey ?? "{}"),
      );
      if (parsed.success) {
        return {
          authToken: parsed.data.authToken,
          fingerprintId: parsed.data.fingerprintId,
          fingerprintHash: parsed.data.fingerprintHash,
        };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Pure wire-shape builder for the Codebuff/Freebuff chat-completions
 * request. Exported (not just `sendToCodebuff`) so the contract is locked
 * in by unit tests that exercise every header + body field independently
 * of the network.
 *
 * Wire format (aligned with
 * `~/.config/manicode/freebuff-model-tests/phase4-deliverables/00-PROTOCOL-SPEC.md`
 * §2.2 + §6 and `final-validations.md` Mission 1):
 *
 *   - Headers (required):
 *       `Authorization: Bearer <authToken>`
 *       `x-codebuff-fingerprint:      <fingerprintId>`
 *       `x-codebuff-fingerprint-hash: <fingerprintHash>`
 *       `x-freebuff-instance-id:      <instanceId>` (only when a session seat
 *         has been acquired via POST /api/v1/freebuff/session)
 *   - Headers (optional, sent by us):
 *       `user-agent: ai-sdk/openai-compatible/<v>/codebuff` — UA is NOT
 *         validated by the upstream (Mission 1 case 4) but we send it for
 *         traceability.
 *       `x-freebuff-model: <model-id>` — sent as a routing hint.
 *       `X-Codebuff-OpenRouter-Api-Key: ...` — BYOK (when FREEBUFF_OPENROUTER_API_KEY is set).
 *   - Body (top-level fields, NOT nested under a `codebuff` wrapper):
 *       `runId: <uuid v4>` — REQUIRED, else 400 "No runId found in request body" (C3).
 *       `model: <model-id>`, `messages: [...]`, `stream: true`,
 *         `stream_options: { include_usage: true }` (OpenAI-shaped core).
 *       `provider: { order?, allow_fallbacks: false, sort: "price" }` — top-level.
 *       `codebuff_metadata: {
 *         fingerprint_id, client_id, agent, user_input_id, cost_mode: "free"
 *       }` — top-level.
 *
 * The older `codebuff.codebuff_metadata` / `codebuff.provider` nested envelope
 * was removed in v3.8.43 — the upstream returns 400 if `runId`, `provider`,
 * or `codebuff_metadata` are nested under `codebuff.*`.
 */
export function buildCodebuffRequestInit(
  body: FreebuffChatRequest,
  credentials: {
    authToken: string;
    fingerprintId: string;
    fingerprintHash?: string;
  },
  options: FreebuffChatOptions,
  resolvedRunId: string,
  env: { openRouterApiKey?: string | undefined } = {},
): { headers: Record<string, string>; payload: Record<string, unknown> } {
  // ── Headers (00-PROTOCOL-SPEC.md §2.2 + validation-scripts/test-headers.ts)
  // The chat-completions endpoint uses the SAME auth header set as
  // agent-runs / session — see `buildFreebuffHeaders` in agentRuns.ts.
  const headers: Record<string, string> = buildFreebuffHeaders(credentials);
  headers.Accept = "text/event-stream";
  headers["x-freebuff-model"] = body.model;
  if (options.instanceId) {
    headers["x-freebuff-instance-id"] = options.instanceId;
  }
  if (env.openRouterApiKey) {
    headers["X-Codebuff-OpenRouter-Api-Key"] = env.openRouterApiKey;
  }

  // ── Body (top-level envelope per 00-PROTOCOL-SPEC.md §6) ────────────
  const { randomUUID } = cryptoModule;
  const userInputId = randomUUID();
  const agentId = getFreebuffAgentId(body.model);

  const codebuffMetadata: Record<string, unknown> = {
    fingerprint_id: credentials.fingerprintId,
    client_id: options.sessionId ?? "codebuff-cli",
    cost_mode: "free",
    user_input_id: userInputId,
    // run_id is the SAME id returned by the upstream agent-runs START
    // call. The server stores the runId against the agent on START and
    // expects the chat-completions call to echo it back in BOTH
    // `codebuff_metadata.run_id` AND at the top level (`runId`).
    run_id: resolvedRunId,
  };
  if (options.instanceId) {
    codebuffMetadata.freebuff_instance_id = options.instanceId;
  }
  if (agentId) {
    codebuffMetadata.agent = agentId;
  }

  const provider: Record<string, unknown> = {
    allow_fallbacks: options.allowFallbacks ?? false,
    sort: "price",
  };
  if (options.providerOrder && options.providerOrder.length > 0) {
    provider.order = options.providerOrder;
  }

  const payload = {
    ...body,
    stream: true,
    stream_options: { include_usage: true },
    // Top-level (NOT nested under `codebuff.*`):
    runId: resolvedRunId,
    provider,
    codebuff_metadata: codebuffMetadata,
  };

  return { headers, payload };
}

/**
 * Send the chat request to the Codebuff upstream. Returns the raw
 * `Response` whose body is a `ReadableStream<Uint8Array>`. Delegates the
 * wire-shape construction to `buildCodebuffRequestInit` (exported for tests).
 */
async function sendToCodebuff(
  body: FreebuffChatRequest,
  format: FreebuffChatFormat,
  credentials: {
    authToken: string;
    fingerprintId: string;
    fingerprintHash?: string;
  },
  options: FreebuffChatOptions,
  resolvedRunId: string,
): Promise<Response> {
  const url = buildCodebuffUpstreamUrl(format);
  const doFetch = options.fetchImpl ?? fetch;

  const { headers, payload } = buildCodebuffRequestInit(
    body,
    credentials,
    options,
    resolvedRunId,
    {
      openRouterApiKey: process.env.FREEBUFF_OPENROUTER_API_KEY,
    },
  );

  return doFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Top-level entry point the OmniRoute SSE dispatcher calls for the
 * freebuff provider branch.
 *
 * @param request  - The incoming OmniRoute HTTP request.
 * @param body     - The pre-parsed body.
 * @param options  - Auth and format selection.
 *
 * Returns a `Response` whose body is the transformed SSE stream.
 */
export async function routeFreebuffChat(
  _request: Request,
  body: unknown,
  options: FreebuffChatOptions,
): Promise<Response> {
  const parsed = freebuffChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid Freebuff request body",
          type: "validation_error",
          issues: parsed.error.issues,
        },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const format = selectTransformerFormat(options);
  const credentials = await loadFreebuffCredentials(options);
  if (!credentials) {
    return new Response(
      JSON.stringify({
        error: {
          message: "No Freebuff connection found for the authenticated user.",
          type: "no_connection",
        },
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Per-token lock scope (C8: serialise the entire chat flow per token —
  // multiple OmniRoute processes sharing the same token would otherwise
  // race the upstream `POST /api/v1/freebuff/session` against each other
  // and trip the no-grace-period `superseded` transition). Computed
  // before the lock so we have it for the wrapper below.
  const seatScope = options.connectionId ?? options.userId;

  // ── Everything upstream-touching runs under the per-token lock so the
  // Codebuff backend never sees two simultaneous writes for the same
  // `authToken`. Different connections (= different tokens) are
  // unaffected and run in parallel.
  return withFreebuffChatLock(seatScope, async () => {
    // ── Seat acquisition (C5/C8: 1-hour TTL, no grace period on superseded) ──
    let seat;
    try {
      seat = await ensureFreebuffSeat({
        connectionId: seatScope,
        modelId: parsed.data.model,
        authToken: credentials.authToken,
        fetcher: options.fetchImpl,
        signal: options.signal,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              err instanceof Error
                ? `Freebuff session acquisition failed: ${err.message}`
                : "Freebuff session acquisition failed",
            type: "session_error",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

  // ── 1) Resolve the upstream agentId for this model ──────────────────
  const agentId = getFreebuffAgentId(parsed.data.model);
  if (!agentId) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Model ${parsed.data.model} is not available on the Freebuff free tier.`,
          type: "model_not_available",
        },
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // ── 2) Register a fresh agent run with the upstream. The chat-completions
  // endpoint rejects every request whose runId has not been previously
  // registered via POST /api/v1/agent-runs {action:"START"} (returns 400
  // with `No runId found in request body` or `runId Not Found: <uuid>`).
  let resolvedRunId: string;
  try {
    resolvedRunId = await startAgentRun({
      credentials,
      agentId,
      baseUrl: resolveFreebuffBaseUrl(),
      signal: options.signal,
      fetcher: options.fetchImpl,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          message:
            err instanceof Error
              ? `Freebuff agent-run handshake failed: ${err.message}`
              : "Freebuff agent-run handshake failed",
          type: "agent_run_error",
          upstreamStatus: (err as { status?: number }).status ?? null,
        },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // ── 3) First chat attempt with the freshly-acquired seat + runId ───────
  const upstream = await tryChat(
    parsed.data,
    format,
    credentials,
    options,
    seat.instanceId,
    resolvedRunId,
  );

  // ── If the upstream says our seat is stale, drop + re-claim + retry ONCE ──
  if (upstream.kind === "superseded") {
    invalidateFreebuffSeat(seatScope, parsed.data.model);
    // Best-effort FINISH on the stale run before we re-acquire.
    void finishAgentRun({
      credentials,
      runId: resolvedRunId,
      status: "canceled",
      totalSteps: 0,
      directCredits: 0,
      totalCredits: 0,
      baseUrl: resolveFreebuffBaseUrl(),
    });
    let freshSeat;
    try {
      freshSeat = await ensureFreebuffSeat({
        connectionId: seatScope,
        modelId: parsed.data.model,
        authToken: credentials.authToken,
        fetcher: options.fetchImpl,
        signal: options.signal,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              err instanceof Error
                ? `Freebuff session re-acquisition failed: ${err.message}`
                : "Freebuff session re-acquisition failed",
            type: "session_error",
          },
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    // Need a fresh runId after re-acquiring the seat.
    let rerunId: string;
    try {
      rerunId = await startAgentRun({
        credentials,
        agentId,
        baseUrl: resolveFreebuffBaseUrl(),
        signal: options.signal,
        fetcher: options.fetchImpl,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              err instanceof Error
                ? `Freebuff agent-run handshake (retry) failed: ${err.message}`
                : "Freebuff agent-run handshake (retry) failed",
            type: "agent_run_error",
          },
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
    const retry = await tryChat(
      parsed.data,
      format,
      credentials,
      options,
      freshSeat.instanceId,
      rerunId,
    );
    return finalizeChat(retry, parsed.data, format, credentials, rerunId);
  }

  return finalizeChat(upstream, parsed.data, format, credentials, resolvedRunId);
  });
}

// ---------------------------------------------------------------------------
// Helpers — try/finish + superseded detection.
// ---------------------------------------------------------------------------

type ChatAttempt =
  | { kind: "ok"; response: Response }
  | { kind: "superseded"; status: number; bodyText: string }
  | { kind: "upstream_error"; status: number; bodyText: string };

async function tryChat(
  body: FreebuffChatRequest,
  format: FreebuffChatFormat,
  credentials: { authToken: string; fingerprintId: string; fingerprintHash?: string },
  options: FreebuffChatOptions,
  instanceId: string,
  runId: string,
): Promise<ChatAttempt> {
  let upstream: Response;
  try {
    upstream = await sendToCodebuff(body, format, credentials, {
      ...options,
      instanceId,
    }, runId);
  } catch (err) {
    return {
      kind: "upstream_error",
      status: 0,
      bodyText:
        err instanceof Error ? err.message : "Freebuff upstream error",
    };
  }

  if (upstream.ok && upstream.body) {
    return { kind: "ok", response: upstream };
  }

  // 4xx / 5xx — read the body so we can detect `superseded` and either
  // invalidate the cached seat (for superseded) or surface the error.
  const errBody = await upstream.text().catch(() => "");
  if (isSupersededResponse(upstream.status, errBody)) {
    return { kind: "superseded", status: upstream.status, bodyText: errBody };
  }
  return { kind: "upstream_error", status: upstream.status, bodyText: errBody };
}

function isSupersededResponse(status: number, body: string): boolean {
  if (status < 400) return false;
  try {
    const parsed = JSON.parse(body);
    return (
      parsed?.status === "superseded" ||
      parsed?.error?.status === "superseded" ||
      /seat\s+(has been\s+)?superseded/i.test(parsed?.message ?? "")
    );
  } catch {
    return /superseded/i.test(body);
  }
}

function finalizeChat(
  attempt: ChatAttempt,
  body: FreebuffChatRequest,
  format: FreebuffChatFormat,
  credentials: { authToken: string; fingerprintId: string; fingerprintHash?: string },
  runId: string,
): Response {
  if (attempt.kind === "ok") {
    const includeSubagent = body.include_subagent_output === true;
    const transformed = pipeStreamThroughTransformer(
      attempt.response.body!,
      format,
      body.model,
      includeSubagent,
    );

    // Best-effort FINISH on stream end. We wrap the SSE stream in a
    // TransformStream whose finalizer fires whether the client cancels,
    // the upstream errors, or the stream completes normally.
    const finisher = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        void finishAgentRun({
          credentials,
          runId,
          status: "completed",
          totalSteps: 1,
          directCredits: 0,
          totalCredits: 0,
          baseUrl: resolveFreebuffBaseUrl(),
        });
      },
      cancel() {
        void finishAgentRun({
          credentials,
          runId,
          status: "canceled",
          totalSteps: 0,
          directCredits: 0,
          totalCredits: 0,
          baseUrl: resolveFreebuffBaseUrl(),
        });
      },
    });
    const tracked = transformed.pipeThrough(finisher);

    return new Response(tracked, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "x-omniroute-subagent-trace": includeSubagent ? "on" : "off",
        "x-omniroute-freebuff-run-id": runId,
      },
    });
  }

  // Both "superseded" (after one retry) and "upstream_error" end up here
  // as 502 — they are upstream problems the caller can't recover from
  // without a re-auth or waiting on the upstream. FINISH the half-started
  // run so the upstream frees the credit.
  void finishAgentRun({
    credentials,
    runId,
    status: "failed",
    totalSteps: 0,
    directCredits: 0,
    totalCredits: 0,
    errorMessage: attempt.bodyText.slice(0, 200),
    baseUrl: resolveFreebuffBaseUrl(),
  });

  return new Response(
    JSON.stringify({
      error: {
        message: `Freebuff upstream returned HTTP ${attempt.status}`,
        type: "upstream_error",
        upstreamStatus: attempt.status,
        body: attempt.bodyText.slice(0, 500),
      },
    }),
    {
      status: attempt.status === 0 ? 502 : Math.max(attempt.status, 502),
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Freebuff chat-stream integration.
 *
 * Bridges the OpenAI-compatible Codebuff/Freebuff backend (rapport
 * `rapport-architecture-reseau-avance.md` §8.2 + `rapport-architecture-
 * freebuff.md` §8) and the OmniRoute SSE dispatcher
 * (`@/sse/handlers/chat`).
 *
 * Pipeline:
 *   1. Parse + validate the incoming body (OpenAI-compatible shape).
 *   2. Resolve the Freebuff connection (authToken + fingerprintId) for the
 *      caller from the OmniRoute connection store.
 *   3. Wrap the body in the `codebuff.codebuff_metadata` + `codebuff.provider`
 *      envelope expected by the upstream backend, and POST it to
 *      `<WEBSITE_URL>/api/v1/chat/completions` (the same endpoint serves
 *      both OpenAI-shaped and Anthropic-shaped requests).
 *   4. Pipe the upstream SSE stream through the OpenAI/Anthropic
 *      transformer so the wire format matches the caller's expectation.
 *
 * @module lib/providers/freebuff/chatIntegration
 */

import { z } from "zod";
import {
  createTransformer,
  type TransformerFormat,
} from "./stream/index.ts";
import { resolveFreebuffBaseUrl } from "./base.ts";

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
 * Send the chat request to the Codebuff upstream. Returns the raw
 * `Response` whose body is a `ReadableStream<Uint8Array>`.
 *
 * Wire format (rapport §4.4 + §8.6 + rapport-freebuff §8):
 *   - Headers: `Authorization: Bearer <token>`, `user-agent:
 *     ai-sdk/openai-compatible/<v>/codebuff`, optional
 *     `X-Codebuff-OpenRouter-Api-Key` (BYOK), `x-freebuff-model`.
 *   - Body: OpenAI Chat Completions shape + `codebuff.codebuff_metadata`
 *     wrapper (`run_id`, `client_id`, `cost_mode: 'free'`, optional
 *     `freebuff_instance_id`) + `codebuff.provider` (`order`,
 *     `allow_fallbacks`) + `stream_options.include_usage: true`.
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
): Promise<Response> {
  const url = buildCodebuffUpstreamUrl(format);
  const doFetch = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${credentials.authToken}`,
    "user-agent": `ai-sdk/openai-compatible/${FREEBUFF_SDK_VERSION}/codebuff`,
    "x-freebuff-model": body.model,
  };
  if (process.env.FREEBUFF_OPENROUTER_API_KEY) {
    headers["X-Codebuff-OpenRouter-Api-Key"] = process.env.FREEBUFF_OPENROUTER_API_KEY;
  }

  // Wrap the OpenAI body in the codebuff envelope expected by the upstream.
  const { randomUUID } = await import("node:crypto");
  const codebuffMetadata: Record<string, unknown> = {
    run_id: randomUUID(),
    client_id: options.sessionId ?? randomUUID(),
    cost_mode: "free",
  };
  if (options.instanceId) {
    codebuffMetadata.freebuff_instance_id = options.instanceId;
  }

  const codebuffProvider: Record<string, unknown> = {
    allow_fallbacks: options.allowFallbacks ?? false,
  };
  if (options.providerOrder && options.providerOrder.length > 0) {
    codebuffProvider.order = options.providerOrder;
  }

  const payload = {
    ...body,
    stream: true,
    stream_options: { include_usage: true },
    codebuff: {
      codebuff_metadata: codebuffMetadata,
      provider: codebuffProvider,
    },
  };

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

  let upstream: Response;
  try {
    upstream = await sendToCodebuff(parsed.data, format, credentials, options);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: {
          message:
            err instanceof Error
              ? `Freebuff upstream error: ${err.message}`
              : "Freebuff upstream error",
          type: "upstream_error",
        },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: {
          message: `Freebuff upstream returned HTTP ${upstream.status}`,
          type: "upstream_error",
          upstreamStatus: upstream.status,
          body: errBody.slice(0, 500),
        },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const includeSubagent = parsed.data.include_subagent_output === true;
  const transformed = pipeStreamThroughTransformer(
    upstream.body,
    format,
    parsed.data.model,
    includeSubagent,
  );

  return new Response(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-omniroute-subagent-trace": includeSubagent ? "on" : "off",
    },
  });
}

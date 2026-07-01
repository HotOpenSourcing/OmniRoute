/**
 * Freebuff chat-stream integration.
 *
 * Bridges the Freebuff SSE transformer (Chunk 5) and the OmniRoute SSE
 * dispatcher (`@/sse/handlers/chat`).
 *
 * Pipeline:
 *   1. Parse + validate the incoming body.
 *   2. Resolve the Freebuff connection (authToken + fingerprintId) for the
 *      caller from the OmniRoute connection store.
 *   3. POST the body to `https://codebuff.com/api/v1/openai/v1/chat/completions`
 *      (or the Anthropic path when `format === "anthropic"`).
 *   4. Pipe the response body through the SSE transformer so the wire
 *      format matches the caller's expectation.
 *
 * @module lib/providers/freebuff/chatIntegration
 */

import { z } from "zod";
import {
  createTransformer,
  type TransformerFormat,
} from "./stream/index.ts";
import { resolveFreebuffBaseUrl } from "./base.ts";

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
 * Build the URL of the upstream Codebuff chat-completions endpoint for the
 * given wire format.
 */
export function buildCodebuffUpstreamUrl(format: FreebuffChatFormat): string {
  const base = resolveFreebuffBaseUrl().replace(/\/$/, "");
  if (format === "anthropic") {
    return `${base}/api/v1/anthropic/v1/messages`;
  }
  return `${base}/api/v1/openai/v1/chat/completions`;
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
 */
async function sendToCodebuff(
  body: FreebuffChatRequest,
  format: FreebuffChatFormat,
  credentials: { authToken: string; fingerprintId: string; fingerprintHash?: string },
  options: FreebuffChatOptions,
): Promise<Response> {
  const url = buildCodebuffUpstreamUrl(format);
  const doFetch = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: format === "anthropic" ? "text/event-stream" : "text/event-stream",
    Authorization: `Bearer ${credentials.authToken}`,
    "x-freebuff-instance-id": credentials.fingerprintId,
  };
  if (credentials.fingerprintHash) {
    headers["x-freebuff-fingerprint-hash"] = credentials.fingerprintHash;
  }
  // Force streaming on the upstream.
  const payload = { ...body, stream: true };

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

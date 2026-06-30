/**
 * Freebuff chat-stream integration shim.
 *
 * This module is the seam between the Freebuff SSE transformer (Chunk 5:
 * `src/lib/providers/freebuff/stream/index.ts`) and the OmniRoute SSE
 * dispatcher (`@/sse/handlers/chat`).
 *
 * HOW IT PLUGS INTO OmniRoute
 * ----------------------------
 * `handleChat` in `@/sse/handlers/chat` dispatches by provider. The
 * dispatch currently lives around line 800+ of that 61K file and inspects
 * the request body / connection settings to pick an upstream client.
 *
 * Once Chunk 4 lands, the dispatch must add a branch like:
 *
 *     if (provider === "freebuff") {
 *       return await routeFreebuffChat(request, parsedBody, options);
 *     }
 *
 * This file exposes that single entry point so the integration is a
 * one-line diff in `handleChat` rather than another large file to audit.
 *
 * STATUS — STUB
 * -------------
 * The actual upstream call (`sendToCodebuff`) requires the Chunk 4
 * provider (session lock, OAuth token, fingerprint header). The function
 * below is structured as a pipeline so filling in Chunk 4 is mechanical:
 *
 *   1. `selectTransformerFormat()` — already implemented (pure).
 *   2. `buildCodebuffUpstreamRequest()` — to be wired to Chunk 4.
 *   3. `sendToCodebuff()` — to be implemented in Chunk 4.
 *   4. `pipeStreamThroughTransformer()` — pure plumbing, ready.
 *
 * Until (2) and (3) land, `routeFreebuffChat` throws
 * `NOT_IMPLEMENTED_ERROR` so callers get a clean 502.
 */

import { z } from "zod";
import {
  createTransformer,
  type TransformerFormat,
  friendlyErrorMessage,
} from "./stream/index.ts";

// ---------------------------------------------------------------------------
// Public types — the contract handleChat must respect.
// ---------------------------------------------------------------------------

export const freebuffChatRequestSchema = z.object({
  /** Either a Freebuff model id (e.g. "mimo/mimo-v2.5") or any alias. */
  model: z.string().min(1),
  messages: z.array(z.unknown()),
  stream: z.boolean().optional().default(false),
  /** Optional client-side toggles consumed by the transformer. */
  include_subagent_output: z.boolean().optional(),
  /** Free-form passthrough for tools, temperature, etc. */
  [key: string]: unknown,
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
   * Authenticated user identifier — used by Chunk 4 to look up the
   * persisted connection (authToken + fingerprintId).
   */
  userId: string;
  /**
   * Optional abort signal — typically the request `signal`.
   */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Step 1 — pure, already implemented.
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

// ---------------------------------------------------------------------------
// Step 4 — pure plumbing, already implemented (compile-time only).
// ---------------------------------------------------------------------------

/**
 * Wraps an upstream Codebuff byte stream with the appropriate SSE
 * transformer. Pure — does no I/O.
 *
 * The upstream stream argument is typed as `ReadableStream<Uint8Array>`
 * which is what the Codebuff HTTP client returns. Chunk 4's job is to
 * produce that stream; this function only wires the pipe.
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
// Public entry point — implemented once Chunk 4 lands.
// ---------------------------------------------------------------------------

const NOT_IMPLEMENTED =
  "freebuff chat integration not implemented — see Chunk 4 (provider upstream call)";

/**
 * Top-level entry point the OmniRoute SSE dispatcher will call once the
 * freebuff provider branch is added to `handleChat`.
 *
 * @param request  - The incoming OmniRoute HTTP request.
 * @param body     - The pre-parsed body (OmniRoute parses it once on the
 *                   hot path — see comments in `chat/completions/route.ts`).
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

  // Steps 2 and 3 are filled in by Chunk 4:
  //   const upstreamReq = buildCodebuffUpstreamRequest(parsed.data, options);
  //   const upstreamRes = await sendToCodebuff(upstreamReq, options.signal);
  //   const transformed  = pipeStreamThroughTransformer(
  //     upstreamRes.body!, format, parsed.data.model, parsed.data.include_subagent_output
  //   );
  //   return new Response(transformed, {
  //     status: 200,
  //     headers: {
  //       "Content-Type": "text/event-stream",
  //       "Cache-Control": "no-cache",
  //       "Connection": "keep-alive",
  //       "x-omniroute-subagent-trace": "off", // toggled per request
  //     },
  //   });

  // Until Chunk 4 lands, surface the gap as a clean 502.
  void format;
  void friendlyErrorMessage; // re-export kept for downstream consumers
  return new Response(
    JSON.stringify({
      error: {
        message: NOT_IMPLEMENTED,
        type: "not_implemented",
        code: "CHUNK_4_PENDING",
      },
    }),
    {
      status: 502,
      headers: { "Content-Type": "application/json" },
    },
  );
}

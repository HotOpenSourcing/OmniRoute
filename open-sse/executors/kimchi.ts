/**
 * Kimchi (Cast AI "AI Enabler") executor.
 *
 * PROBLEM (live-confirmed 2026-06-30):
 * The Cast AI router at llm.kimchi.dev has TWO separate backends:
 *   - Non-streaming path (Accept: application/json  / stream: false) → works correctly
 *   - Streaming path    (Accept: text/event-stream  / stream: true)  → returns a false
 *     "provider has exhausted its credits" 503 even when credits are available
 *
 * ROOT CAUSE:
 * The streaming backend has a separate (exhausted) credit pool / routing layer.
 * The router dispatches on the HTTP Accept header, not just the body stream flag:
 *   Accept: text/event-stream  → broken streaming backend → 503
 *   Accept: application/json   → healthy non-streaming backend → 200
 *
 * FIX:
 * 1. Override buildHeaders() to always emit Accept: application/json (stream=false path).
 * 2. Override transformRequest() to strip stream: true / stream_options from the body.
 * 3. The client still receives a proper SSE stream: chatCore's maybeConvertJsonBodyToSse
 *    converts the non-streaming JSON response to SSE before it reaches the client.
 *
 * Source: reverse-engineered from the Kimchi CLI binary (v0.1.50).
 * Live-tested 2026-06-30 — non-streaming: 200 ✓, streaming upstream: 503 ✗.
 */

import { DefaultExecutor } from "./default.ts";
import type { ProviderCredentials } from "./base.ts";

export class KimchiExecutor extends DefaultExecutor {
  constructor(provider = "kimchi") {
    super(provider);
  }

  /**
   * Force Accept: application/json regardless of the client-side stream flag.
   * The Cast AI router dispatches on this header — text/event-stream routes to
   * the broken streaming backend that reports "credits exhausted".
   */
  buildHeaders(
    credentials: ProviderCredentials,
    _stream: boolean,
    clientHeaders?: Record<string, string> | null,
    model?: string
  ): Record<string, string> {
    // Pass stream=false so BaseExecutor emits Accept: application/json
    return super.buildHeaders(credentials, false, clientHeaders, model);
  }

  /**
   * Force stream=false in the upstream request body and strip stream_options.
   * The non-streaming JSON response is converted to SSE by maybeConvertJsonBodyToSse
   * in chatCore before it reaches the client — the client experience is unchanged.
   */
  transformRequest(
    model: string,
    body: unknown,
    _stream: boolean,
    credentials: Record<string, unknown> | null
  ): unknown {
    // Delegate to DefaultExecutor with stream=false so stream_options are not injected
    const result = super.transformRequest(model, body, false, credentials);

    if (result && typeof result === "object" && !Array.isArray(result)) {
      const record = { ...(result as Record<string, unknown>) };
      record.stream = false;
      delete record.stream_options;
      return record;
    }

    return result;
  }
}

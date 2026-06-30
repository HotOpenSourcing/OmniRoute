/**
 * Kimchi (Cast AI "AI Enabler") executor.
 *
 * The upstream router at llm.kimchi.dev does not reliably support streaming
 * requests — it returns an in-stream 503 "provider has exhausted its credits"
 * error even when credits are available and the same request succeeds with
 * stream=false. Force non-streaming upstream and let the JSON-to-SSE bridge
 * (maybeConvertJsonBodyToSse in chatCore) convert the response to streaming
 * format for the client.
 *
 * Source: reverse-engineered from the Kimchi CLI binary (v0.1.50); live-tested
 * 2026-06-30 against kimi-k2.7, minimax-m3, deepseek-v4-flash, glm-5.2-fp8.
 */

import { DefaultExecutor } from "./default.ts";

export class KimchiExecutor extends DefaultExecutor {
  constructor(provider = "kimchi") {
    super(provider);
  }

  /**
   * Force stream=false in the upstream body — Kimchi's Cast AI router rejects
   * streaming requests with a false "credits exhausted" error.
   *
   * The caller-side stream flag is preserved (Accept: text/event-stream header)
   * so the response is routed through the JSON-to-SSE bridge in chatCore,
   * which converts the non-streaming JSON response to SSE for the client.
   */
  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    credentials: Record<string, unknown> | null
  ): unknown {
    // Delegate to DefaultExecutor with stream=false so stream_options etc.
    // are not injected (they are invalid on non-streaming upstream requests).
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

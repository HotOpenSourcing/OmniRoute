/**
 * Freebuff CLI Emulator — Main Orchestrator (`emulateChat`)
 *
 * Public entry point that ties together every component of the
 * emulator:
 *
 *   1. Resolve the fallback chain for the requested model
 *      (`fallbackChain.buildFallbackChain`).
 *   2. For each candidate, attempt the full flow:
 *        a. Acquire a queue seat via the session manager.
 *        b. Register an agent run via the agent runner.
 *        c. POST the chat completion (top-level envelope) and pipe
 *           the upstream SSE stream back to the caller.
 *      Errors are classified (`fallbackChain.classifyError`) and
 *      either abort the chain, retry the same model, skip to the next
 *      model, or downgrade to the next tier.
 *   3. Return the first successful `Response` (whose body is the
 *      upstream SSE stream, already framed per the caller's format).
 *
 * The orchestrator is the bridge between the OmniRoute executor
 * (`open-sse/executors/freebuff.ts`) and the low-level emulator
 * primitives. It is intentionally framework-agnostic: it does not
 * import from `chatIntegration.ts` so the two implementations can
 * coexist (the legacy path stays as a fallback while the emulator
 * matures).
 *
 * @module lib/providers/freebuff/cliEmulator/emulateChat
 */

import type {
  FreebuffChatContext,
  FreebuffChatInput,
  FreebuffHttpClient,
  FreebuffHttpResponse,
  FreebuffSession,
  FreebuffSessionManager,
  FreebuffAgentRunner,
} from "./types.ts";
import {
  FreebuffAuthError,
  FreebuffCountryBlockedError,
  FreebuffEmptyOutputError,
  FreebuffSessionError,
} from "./types.ts";
import { createHttpClient } from "./httpClient.ts";
import { createSessionManager, FREEBUFF_BASE_URL } from "./sessionManager.ts";
import { createAgentRunner } from "./agentRunner.ts";
import { buildEnvelope, buildHeaders, generateClientId, generateUserInputId } from "./envelopeBuilder.ts";
import { buildFallbackChain, classifyError, nextCandidate, type FallbackCandidate } from "./fallbackChain.ts";
import { getModelDescriptor, stripProviderPrefix } from "./modelRegistry.ts";
import { resolveFreebuffBaseUrl } from "../base.ts";
import { createTransformer, type TransformerFormat } from "../stream/index.ts";
import { EMPTY_OUTPUT_REGEX } from "../../../../../open-sse/services/errorClassifier.ts";

/**
 * Peek the first bytes of an upstream SSE stream to detect an early
 * empty-output error. Returns the error message + buffered chunks if
 * detected (so the caller can rebuild the stream), otherwise null.
 * @internal - Exported for testing only
 */
export async function peekEmptyOutputError(
  body: ReadableStream<Uint8Array>,
): Promise<{ message: string | null; buffered: Uint8Array[] }> {
  const reader = body.getReader();
  const buffered: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let sniffed = "";
  const maxBytes = 8192;
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffered.push(value);
      total += value.byteLength;
      sniffed += decoder.decode(value, { stream: true });
      if (EMPTY_OUTPUT_REGEX.test(sniffed)) {
        // Extract the error message — usually wrapped in a "data:" SSE frame.
        const match =
          sniffed.match(/data:\s*(\{.*?"message"\s*:\s*"[^"]*empty[^"]*".*?\})/i) ??
          sniffed.match(/(model output error:[^"\\]*)/i);
        return { message: match?.[1] ?? match?.[0] ?? "empty_output", buffered };
      }
    }
  } catch {
    return { message: null, buffered };
  } finally {
    reader.releaseLock();
  }

  // No empty-output error detected — caller must rebuild the stream from buffered chunks.
  return { message: null, buffered };
}

/**
 * Rebuild a ReadableStream from buffered chunks + the original stream.
 * Used after peekEmptyOutputError to restore the stream for downstream consumers.
 * @internal - Exported for testing only
 */
export function rebuildStream(
  buffered: Uint8Array[],
  original: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < buffered.length) {
        controller.enqueue(buffered[index++]!);
        return;
      }
      const reader = original.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (value) controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/**
 * Options for `emulateChat()`. Extends `FreebuffChatInput` with
 * emulator-specific knobs (format, signal, overrides).
 */
export interface EmulateChatOptions extends FreebuffChatContext {
  /** SSE wire format expected by the caller. Defaults to "openai". */
  format?: TransformerFormat;
  /** Abort signal propagated to every upstream call. */
  signal?: AbortSignal;
}

/**
 * Result of a successful `emulateChat()` call.
 */
export interface EmulateChatResult {
  /** The upstream SSE response (already framed for the caller's format). */
  response: Response;
  /** The model that ultimately served the request (may differ from input). */
  servedModel: string;
  /** The tier of the serving model. */
  servedTier: "premium" | "standard" | "limited" | "legacy";
  /** The agent id stamped on the upstream request. */
  agent: string;
  /** The runId returned by the upstream agent-runs START. */
  runId: string;
  /** The seat instance id acquired from POST /freebuff/session. */
  instanceId: string;
  /** Number of fallback attempts before success (0 = first try). */
  fallbackAttempts: number;
}

/**
 * Error thrown when the entire fallback chain is exhausted.
 */
export class FreebuffChainExhaustedError extends Error {
  readonly code = "chain_exhausted";
  constructor(
    message: string,
    public readonly attempts: ReadonlyArray<{
      model: string;
      tier: string;
      error: string;
    }>,
  ) {
    super(message);
    this.name = "FreebuffChainExhaustedError";
  }
}

/**
 * Main entry point. Attempts the requested chat completion, walking
 * the fallback chain on recoverable errors.
 *
 * @throws {FreebuffAuthError} when the auth token is invalid/expired.
 * @throws {FreebuffChainExhaustedError} when every candidate failed.
 */
export async function emulateChat(
  input: FreebuffChatInput,
  options: EmulateChatOptions,
): Promise<EmulateChatResult> {
  const format: TransformerFormat = options.format ?? "openai";
  const requestedModelId = stripProviderPrefix(input.model);
  const chain = buildFallbackChain(requestedModelId);

  if (chain.length === 0) {
    throw new FreebuffChainExhaustedError(
      `No fallback candidates available for model ${requestedModelId}`,
      [],
    );
  }

  // Resolve dependencies once (HTTP client only)
  const httpClient = options.httpClient ?? (await createHttpClient());
  const baseUrl = resolveFreebuffBaseUrl() || FREEBUFF_BASE_URL;

  const clientId = options.sessionId ?? generateClientId();
  const attempts: Array<{ model: string; tier: string; error: string }> = [];

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i]!;
    const attemptIndex = i;

    try {
      const result = await attemptChat(
        input,
        candidate,
        options,
        format,
        httpClient,
        baseUrl,
        clientId,
      );
      return {
        ...result,
        fallbackAttempts: attemptIndex,
      };
    } catch (err) {
      // Abort on auth errors — no point trying other models.
      if (err instanceof FreebuffAuthError) throw err;

      const decision = classifyError(err);
      attempts.push({
        model: candidate.model.id,
        tier: candidate.tier,
        error: decision.reason,
      });

      // Try the next candidate.
      const next = nextCandidate(chain, attemptIndex, err);
      if (!next) break;
      // Continue the loop with the next index.
      i = next.index - 1; // -1 because the for-loop will i++
    }
  }

  throw new FreebuffChainExhaustedError(
    `All ${chain.length} fallback candidates failed for model ${requestedModelId}`,
    attempts,
  );
}

/**
 * Attempt a single chat completion against one candidate model.
 * Returns the transformed SSE response on success.
 */
async function attemptChat(
  input: FreebuffChatInput,
  candidate: FallbackCandidate,
  options: EmulateChatOptions,
  format: TransformerFormat,
  httpClient: FreebuffHttpClient,
  baseUrl: string,
  clientId: string,
): Promise<Omit<EmulateChatResult, "fallbackAttempts">> {
  const { credentials } = options;

  // 1. Generate instance ID directly (no session claim needed)
  // The real CLI doesn't call /api/v1/freebuff/session — it generates
  // a UUID and sends it in codebuff_metadata.freebuff_instance_id
  const instanceId = crypto.randomUUID();
  const session: FreebuffSession = {
    status: "active",
    instanceId,
    model: candidate.model.id,
    admittedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), // +1h
    remainingMs: 3600000,
    accessTier: "limited",
  };

  // 2. Register an agent run (real CLI calls /api/v1/agent-runs before chat)
  const agentRunner = createAgentRunner(httpClient, baseUrl);
  const agentRun = await agentRunner.start({
    authToken: credentials.authToken,
    agent: candidate.model.agent,
    model: candidate.model.id,
    fingerprintId: credentials.fingerprintId,
    ...(credentials.fingerprintHash
      ? { fingerprintHash: credentials.fingerprintHash }
      : {}),
    instanceId: session.instanceId,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  // 3. Build the wire envelope + headers.
  const userInputId = generateUserInputId();
  const traceSessionId = generateUserInputId();
  const envelope = buildEnvelope({
    input: { ...input, model: candidate.model.id },
    credentials,
    session,
    runId: agentRun.runId,
    agent: candidate.model.agent,
    clientId,
    userInputId,
    traceSessionId,
  });
  const headers = buildHeaders(credentials, session, candidate.model.id);

  // 4. POST the chat completion.
  const upstream = await postChat(
    httpClient,
    `${baseUrlFor(resolveFreebuffBaseUrl())}/api/v1/chat/completions`,
    headers,
    envelope,
    options.signal,
  );

  // Diagnostic: log envelope + upstream status for debugging empty-output loops.
  // #freebuff-empty-output — when the upstream returns 200 with a stream that
  // closes immediately with "model output must contain either output text or
  // tool calls", we need to see exactly what envelope we sent and what the
  // upstream responded with to determine if the issue is on our side.
  if (process.env.FREEBUFF_DEBUG === "1") {
    try {
      // eslint-disable-next-line no-console
      console.log("[freebuff-debug] envelope keys:", Object.keys(envelope as object).join(","));
      // eslint-disable-next-line no-console
      console.log(
        "[freebuff-debug] envelope.model:",
        (envelope as { model?: string })?.model,
        "agent:",
        (envelope as { agent?: string })?.agent,
        "runId:",
        (envelope as { runId?: string })?.runId
      );
      // eslint-disable-next-line no-console
      console.log("[freebuff-debug] upstream status:", upstream.status, "content-type:", upstream.headers.get("content-type"));
    } catch {
      /* ignore logging errors */
    }
  }

  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    if (process.env.FREEBUFF_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[freebuff-debug] upstream non-ok body:", bodyText.slice(0, 500));
    }
    throw new FreebuffSessionError(
      `Freebuff chat returned HTTP ${upstream.status}: ${bodyText.slice(0, 200)}`,
      upstream.status,
      bodyText.slice(0, 500),
    );
  }

  // Peek the first bytes to detect an early empty-output error from the upstream.
  // If detected, throw a typed error so the fallback chain can skip to the next
  // candidate instead of waiting for the readiness timeout.
  const peekResult = await peekEmptyOutputError(upstream.body);
  if (peekResult.message) {
    if (process.env.FREEBUFF_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.log("[freebuff-debug] detected empty-output error early:", peekResult.message.slice(0, 300));
    }
    throw new FreebuffEmptyOutputError(peekResult.message, candidate.model.id);
  }

  // No empty-output error detected — rebuild the stream from buffered chunks
  // so the downstream transformer can consume it from the start.
  if (peekResult.buffered.length > 0) {
    const rebuilt = rebuildStream(peekResult.buffered, upstream.body);
    // Mutate the response-like wrapper so the pipe below sees the rebuilt stream.
    (upstream as { body: ReadableStream<Uint8Array> }).body = rebuilt;
  }

  // 5. Pipe the upstream SSE stream through the caller's transformer.
  const transformed = upstream.body.pipeThrough(
    createTransformer(format, { model: candidate.model.id }),
  );

  // 6. Wrap in a Response.
  const response = new Response(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "x-omniroute-freebuff-run-id": agentRun.runId,
      "x-omniroute-freebuff-instance": session.instanceId,
      "x-omniroute-freebuff-tier": candidate.tier,
      "x-omniroute-freebuff-model": candidate.model.id,
    },
  });

  // 7. Best-effort FINISH on stream end.
  const finisher = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
    flush() {
      void agentRunner.finish({
        authToken: credentials.authToken,
        runId: agentRun.runId,
        status: "completed",
      });
    },
    cancel() {
      void agentRunner.finish({
        authToken: credentials.authToken,
        runId: agentRun.runId,
        status: "canceled",
      });
    },
  });
  // Re-wrap with the finisher.
  const tracked = response.body!.pipeThrough(finisher);
  const finalResponse = new Response(tracked, response);

  return {
    response: finalResponse,
    servedModel: candidate.model.id,
    servedTier: candidate.model.tier,
    agent: candidate.model.agent,
    runId: agentRun.runId,
    instanceId: session.instanceId,
  };
}

/**
 * POST the chat-completions envelope to the upstream.
 */
async function postChat(
  httpClient: FreebuffHttpClient,
  url: string,
  headers: Record<string, string>,
  envelope: unknown,
  signal: AbortSignal | undefined,
): Promise<FreebuffHttpResponse> {
  return httpClient.fetch({
    url,
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Normalize a base URL (strip trailing slash).
 */
function baseUrlFor(url: string): string {
  return url.replace(/\/$/, "");
}

// Re-export commonly-used types for convenience.
export type { FreebuffChatInput, FreebuffChatContext } from "./types.ts";
export { getModelDescriptor, stripProviderPrefix } from "./modelRegistry.ts";

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

  // Resolve dependencies once (HTTP client, session manager, agent runner).
  const httpClient = options.httpClient ?? (await createHttpClient());
  const baseUrl = resolveFreebuffBaseUrl() || FREEBUFF_BASE_URL;
  const sessionManager =
    options.sessionManager ?? createSessionManager(httpClient, baseUrl);
  const agentRunner =
    options.agentRunner ?? createAgentRunner(httpClient, baseUrl);

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
        sessionManager,
        agentRunner,
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
  sessionManager: FreebuffSessionManager,
  agentRunner: FreebuffAgentRunner,
  clientId: string,
): Promise<Omit<EmulateChatResult, "fallbackAttempts">> {
  const { credentials } = options;

  // 1. Acquire a queue seat.
  let session: FreebuffSession;
  try {
    session = await sessionManager.claim({
      authToken: credentials.authToken,
      modelId: candidate.model.id,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    // Map country-blocked to a typed error so the fallback chain can
    // downgrade to the limited tier.
    if (err instanceof FreebuffCountryBlockedError) throw err;
    if (err instanceof FreebuffSessionError) throw err;
    throw new FreebuffSessionError(
      err instanceof Error ? err.message : String(err),
      undefined,
      undefined,
    );
  }

  // 2. Register an agent run.
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

  if (!upstream.ok || !upstream.body) {
    const bodyText = await upstream.text().catch(() => "");
    throw new FreebuffSessionError(
      `Freebuff chat returned HTTP ${upstream.status}: ${bodyText.slice(0, 200)}`,
      upstream.status,
      bodyText.slice(0, 500),
    );
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

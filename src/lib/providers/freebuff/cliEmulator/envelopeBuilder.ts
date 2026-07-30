/**
 * Freebuff CLI Emulator — Wire Envelope Builder
 *
 * Pure functions that build the top-level wire envelope required by
 * `POST /api/v1/chat/completions`. The upstream REQUIRES `runId`,
 * `provider`, and `codebuff_metadata` at the top level — NOT nested
 * under a `codebuff` wrapper.
 *
 * @module lib/providers/freebuff/cliEmulator/envelopeBuilder
 */

import { randomUUID } from "node:crypto";
import type {
  FreebuffChatInput,
  FreebuffCredentials,
  FreebuffHeaders,
  FreebuffSession,
  FreebuffWireEnvelope,
} from "./types.ts";
import { FREEBUFF_SDK_VERSION } from "../chatIntegration.ts";

/**
 * SDK version stamped on the `user-agent` header. Matches the exact
 * pattern observed in mitmproxy capture of real CLI (2026-07-14).
 */
export const USER_AGENT = `ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser`;

/**
 * Build the HTTP headers required for every upstream request.
 * 
 * CRITICAL: Based on mitmproxy capture, the real CLI does NOT send:
 * - x-codebuff-fingerprint
 * - x-codebuff-fingerprint-hash
 * - x-freebuff-instance-id
 * - x-freebuff-model
 * 
 * These values are sent in the request BODY under `codebuff_metadata`.
 */
export function buildHeaders(
  credentials: FreebuffCredentials,
  session?: FreebuffSession | null,
  model?: string,
): FreebuffHeaders {
  const headers: Record<string, string | undefined> = {
    Authorization: `Bearer ${credentials.authToken}`,
    "Content-Type": "application/json",
    Accept: "*/*",
    "user-agent": USER_AGENT,
  };
  return headers as FreebuffHeaders;
}

/**
 * Build the top-level wire envelope for a chat completion request.
 *
 * The envelope is the canonical shape that the upstream expects:
 *   - `runId` at the top level (correlation id from agent-runs START)
 *   - `provider` at the top level (routing config)
 *   - `codebuff_metadata` at the top level (fingerprint + agent info)
 *   - `model`, `messages`, `stream` at the top level (OpenAI shape)
 */
export interface BuildEnvelopeInput {
  readonly input: FreebuffChatInput;
  readonly credentials: FreebuffCredentials;
  readonly session: FreebuffSession;
  readonly runId: string;
  readonly agent: string;
  readonly clientId: string;
  readonly userInputId: string;
  readonly traceSessionId?: string;
  readonly costMode?: "free" | "paid";
  readonly providerOrder?: string[];
  readonly allowFallbacks?: boolean;
}

export function buildEnvelope({
  input,
  credentials,
  session,
  runId,
  agent,
  clientId,
  userInputId,
  traceSessionId,
  costMode = "free",
  providerOrder,
  allowFallbacks = false,
}: BuildEnvelopeInput): FreebuffWireEnvelope {
  const stream = input.stream ?? true;

  // Extract OpenAI-shaped fields that must NOT be nested.
  const {
    model,
    messages,
    stream: _stream,
    stream_options,
    max_tokens,
    temperature,
    tools,
    tool_choice,
    ...passthrough
  } = input;

  // Build the top-level envelope.
  const envelope: FreebuffWireEnvelope = {
    model,
    messages,
    stream,
    ...(stream_options ? { stream_options } : {}),
    stop: ['"cb_easp"'], // Stop token from real CLI capture
    runId,
    provider: {
      ...(providerOrder && providerOrder.length > 0 ? { order: providerOrder } : {}),
      allow_fallbacks: allowFallbacks,
      sort: "price",
      data_collection: "deny", // Privacy flag from real CLI
    },
    codebuff_metadata: {
      freebuff_instance_id: session.instanceId,
      trace_session_id: traceSessionId,
      run_id: runId,
      client_id: clientId,
      cost_mode: costMode,
    },
    // Free-form passthrough for tools, temperature, etc.
    ...(max_tokens !== undefined ? { max_tokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(tool_choice !== undefined ? { tool_choice } : {}),
    ...passthrough,
  };

  return envelope;
}

/**
 * Generate a stable client id for the session. The CLI uses a UUID
 * generated at startup; we mirror that behavior.
 */
export function generateClientId(): string {
  return randomUUID();
}

/**
 * Generate a per-request user input id. The CLI generates a fresh
 * UUID for every chat completion request.
 */
export function generateUserInputId(): string {
  return randomUUID();
}

/**
 * Resolve the provider order for a given model. The CLI sends an
 * ordered list of preferred providers; the upstream routes on this.
 */
export function resolveProviderOrder(modelId: string): string[] {
  // Heuristic mapping based on the model id prefix.
  if (modelId.startsWith("deepseek/")) return ["DeepSeek"];
  if (modelId.startsWith("mimo/")) return ["Xiaomi"];
  if (modelId.startsWith("moonshotai/")) return ["Moonshot"];
  if (modelId.startsWith("z-ai/")) return ["Z.AI"];
  if (modelId.startsWith("minimax/")) return ["Anthropic", "Bedrock"];
  return [];
}

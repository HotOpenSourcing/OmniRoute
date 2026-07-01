/**
 * Freebuff (Codebuff Free Tier) SSE transformer — facade module.
 *
 * Converts the **standard OpenAI SSE stream** emitted by the Codebuff/Freebuff
 * upstream backend (rapport §5.2 + §9) into the wire format expected by the
 * caller (OpenAI for `/v1/chat/completions`, Anthropic for `/v1/messages`).
 *
 * Architecture
 * ------------
 *   - `openaiTransformer.ts`  : OpenAI SSE → OpenAI SSE (relay/passthrough).
 *   - `anthropicTransformer.ts` : OpenAI SSE → Anthropic SSE.
 *   - `createTransformer(format, options)` : factory that returns the right
 *     `TransformStream` for the caller. OpenAI is the source of truth — the
 *     per-format transformers only re-frame chunks.
 *
 * Note on legacy `events.ts`
 * --------------------------
 * Earlier revisions of this module assumed the upstream emitted a custom
 * Codebuff wire format (`response-chunk`, `reasoning_delta`, `tool-call`,
 * `prompt-error`, `subagent-response-chunk`). Static analysis of the
 * real Codebuff/Freebuff CLI binary (`rapport-architecture-reseau-avance.md`
 * §5.2 + `rapport-architecture-freebuff.md` §9) confirms the upstream
 * actually emits standard OpenAI SSE chunks — so the custom-event parser
 * `CodebuffSseParser` and its `events.ts` schema definitions are obsolete.
 * The file `src/lib/providers/freebuff/events.ts` is kept for now as a
 * legacy reference; new code should consume OpenAI SSE directly via the
 * transformers below.
 */

// ---------------------------------------------------------------------------
// Transformer contract.
// ---------------------------------------------------------------------------

export type TransformerFormat = "openai" | "anthropic";

export interface TransformerOptions {
  /** Model identifier to stamp on every outgoing chunk (e.g. "mimo-v2.5"). */
  model: string;
}

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

import { createOpenAITransformer } from "./openaiTransformer.ts";
import { createAnthropicTransformer } from "./anthropicTransformer.ts";

export function createTransformer(
  format: TransformerFormat,
  options: TransformerOptions,
): TransformStream<Uint8Array, Uint8Array> {
  if (format === "openai") return createOpenAITransformer(options);
  if (format === "anthropic") return createAnthropicTransformer(options);
  throw new Error(`Unknown transformer format: ${format as string}`);
}

// ---------------------------------------------------------------------------
// Shared helpers — re-exported for the per-format transformers and tests.
// ---------------------------------------------------------------------------

export interface SseEnvelope {
  /** Optional `event:` line value. OpenAI format omits this. */
  event?: string;
  /** The JSON payload (stringified by the caller). */
  data: string;
}

export function formatSseFrame(envelope: SseEnvelope): string {
  const lines: string[] = [];
  if (envelope.event) lines.push(`event: ${envelope.event}`);
  // The SSE spec requires each `data:` line on its own line; payloads must
  // not contain a literal newline without being split. We JSON.stringify
  // upstream, so multi-line payloads should not occur in practice.
  for (const dataLine of envelope.data.split("\n")) {
    lines.push(`data: ${dataLine}`);
  }
  lines.push("", ""); // blank line terminator
  return lines.join("\n");
}


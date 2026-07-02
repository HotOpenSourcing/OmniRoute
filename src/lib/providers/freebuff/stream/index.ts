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
// Canonical event types and parser (still used by the per-format
// transformers and the test suite until they are rewritten to consume
// plain OpenAI SSE directly).
// ---------------------------------------------------------------------------

export type {
  CodebuffEvent,
  ReasoningDeltaEvent,
  ToolCallEvent,
  ToolCallRequestEvent,
  ResponseChunkEvent,
  SubagentResponseChunkEvent,
  PromptResponseEvent,
  PromptErrorEvent,
} from "../events.ts";

export { parseCodebuffEvent, safeParseCodebuffEvent } from "../events.ts";

// ---------------------------------------------------------------------------
// Transformer contract.
// ---------------------------------------------------------------------------

export type TransformerFormat = "openai" | "anthropic";

export interface TransformerOptions {
  /** Model identifier to stamp on every outgoing chunk (e.g. "mimo-v2.5"). */
  model: string;
}

// ---------------------------------------------------------------------------
// SSE parser — consumes raw bytes and yields canonical CodebuffEvent
// instances via `safeParseCodebuffEvent`.
// ---------------------------------------------------------------------------

import type { CodebuffEvent } from "../events.ts";
import { safeParseCodebuffEvent } from "../events.ts";

const EVENT_SEPARATOR = "\n\n";

export class CodebuffSseParser {
  private buffer = "";

  /** Feed a chunk of decoded text. Returns 0..N complete events. */
  push(chunk: string): CodebuffEvent[] {
    this.buffer += chunk;
    const events: CodebuffEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf(EVENT_SEPARATOR)) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + EVENT_SEPARATOR.length);
      const event = parseBlock(block);
      if (event) events.push(event);
    }
    return events;
  }

  /** Flush any trailing partial block at end-of-stream. */
  flush(): CodebuffEvent[] {
    if (this.buffer.trim().length === 0) return [];
    const block = this.buffer;
    this.buffer = "";
    const event = parseBlock(block);
    return event ? [event] : [];
  }
}

function parseBlock(block: string): CodebuffEvent | null {
  let eventType: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
    // Comment lines (":…") and other fields are ignored.
  }

  const data = dataLines.join("\n");

  // Build the payload — three cases:
  //   1. data is empty → use the event type as a hint, otherwise null
  //   2. data is valid JSON → use it directly, then stamp `type` from the
  //      SSE `event:` line so discriminated unions in `events.ts` can
  //      route on it. The upstream server does not always include
  //      `type` inside the JSON body, so the event line is authoritative.
  //   3. data is non-JSON → treat it as raw text (binary-observed shape)
  let payload: unknown;
  if (data.length === 0) {
    payload = eventType ? { type: eventType } : null;
  } else {
    try {
      payload = JSON.parse(data);
      if (
        eventType &&
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        (payload as Record<string, unknown>).type = eventType;
      }
    } catch {
      payload = data;
    }
  }

  if (payload === null || payload === undefined) return null;

  const result = safeParseCodebuffEvent(payload);
  return result.ok ? result.event : null;
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

// ---------------------------------------------------------------------------
// Error message mapper — re-exported for the per-format transformers.
// ---------------------------------------------------------------------------

/**
 * Map a Codebuff `prompt-error` to a user-facing message.
 *
 * Specifically, country-block errors must not leak raw server-side detail
 * (stack traces, internal codes) to the client — we translate them into a
 * short, actionable sentence.
 */
export function friendlyErrorMessage(
  event: Extract<CodebuffEvent, { type: "prompt-error" }>,
): string {
  if (event.countryBlockReason) {
    return `Request blocked by Codebuff for region: ${event.countryBlockReason}. Try routing OmniRoute through a proxy in an allowed region.`;
  }
  if (event.code === "rate_limited") {
    return "Codebuff rate limit reached. Wait a few seconds and retry, or enable a fallback provider in OmniRoute.";
  }
  if (event.code === "unauthenticated") {
    return "Codebuff session expired. Re-authenticate via the Freebuff dashboard in OmniRoute.";
  }
  return event.message || "Unknown error from Codebuff.";
}


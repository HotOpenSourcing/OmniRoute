/**
 * Freebuff (Codebuff Free Tier) SSE transformer — facade module.
 *
 * Converts the proprietary Codebuff SSE stream emitted by `freebuff.exe`
 * into standard OpenAI / Anthropic SSE formats consumable by third-party
 * clients (openai SDK, anthropic SDK, Open WebUI, etc.).
 *
 * ALINGED WITH `events.ts` — Chunk 1
 * ----------------------------------
 * As of Chunk 1, the canonical event types live in
 * `src/lib/providers/freebuff/events.ts` (extracted from
 * `~/.config/manicode/freebuff.exe`). This module:
 *
 *   - Re-exports `CodebuffEvent` and the canonical parser
 *   - Owns the SSE-framing `CodebuffSseParser` that turns raw bytes into
 *     `CodebuffEvent` instances via `parseCodebuffEvent`
 *   - Owns the `formatSseFrame` helper used by both transformers
 *   - Owns the `friendlyErrorMessage` mapper (Chunk 5 acceptance:
 *     country_blocked → readable message, no stack traces)
 *   - Owns the `createTransformer` factory
 *
 * The per-format transformers (`openaiTransformer.ts`,
 * `anthropicTransformer.ts`) consume `CodebuffEvent` directly and have
 * no knowledge of SSE framing.
 */

// ---------------------------------------------------------------------------
// Re-export the canonical event types and parser from `events.ts`.
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
  /**
   * When true, `subagent-response-chunk` events are emitted as visible
   * content to the client. When false (default) they are dropped silently
   * — the wrapper route can still surface them via the
   * `x-omniroute-subagent-trace` debug header.
   */
  includeSubagentOutput?: boolean;
}

// ---------------------------------------------------------------------------
// SSE parser — consumes raw bytes and yields canonical CodebuffEvent
// instances via `parseCodebuffEvent`. The framing (event:/data: lines)
// is split here; payload normalisation is delegated to events.ts.
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
  //   2. data is valid JSON → use it directly
  //   3. data is non-JSON → treat it as raw text (binary-observed shape)
  let payload: unknown;
  if (data.length === 0) {
    payload = eventType ? { type: eventType } : null;
  } else {
    try {
      payload = JSON.parse(data);
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

/**
 * Freebuff (Codebuff Free Tier) SSE transformer.
 *
 * Converts the proprietary Codebuff SSE stream emitted by `freebuff.exe`
 * into standard OpenAI / Anthropic SSE formats consumable by third-party
 * clients (openai SDK, anthropic SDK, Open WebUI, etc.).
 *
 * SPEC-DERIVED TYPES — NOTE
 * --------------------------
 * The `CodebuffEvent` shapes below are derived from the prose of the
 * Freebuff chunked spec (Chunks 1 / 5). They cover the events named in the
 * spec — `response-chunk`, `reasoning_delta`, `subagent-response-chunk`,
 * `tool-call-request`, `prompt-response`, `prompt-error` — but the precise
 * field names of the JSON payloads (especially `agentId` / `arguments` /
 * `countryBlockReason`) are best-effort guesses and **must be recalibrated**
 * once Chunk 1 lands real zod schemas extracted from the binary.
 *
 * Each consumer of these types should import them from this module so the
 * recalibration is a one-file diff.
 */

// ---------------------------------------------------------------------------
// Source event types (Codebuff SSE).
// ---------------------------------------------------------------------------

export type CodebuffEvent =
  | { type: "response-chunk"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "subagent-response-chunk"; agentId: string; text: string }
  | {
      type: "tool-call-request";
      id: string;
      name: string;
      arguments: unknown;
    }
  | { type: "prompt-response" }
  | {
      type: "prompt-error";
      code?: string;
      message: string;
      countryBlockReason?: string;
    };

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
// SSE parser — consumes raw bytes and yields typed Codebuff events.
// ---------------------------------------------------------------------------

const EVENT_SEPARATOR = "\n\n";

export class CodebuffSseParser {
  private buffer = "";

  /**Feed a chunk of decoded text. Returns 0..N complete events. */
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

  /**Flush any trailing partial block at end-of-stream. */
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
    // Comment lines (starting with ":") and other fields are ignored.
  }

  if (!eventType) return null;

  const data = dataLines.join("\n");
  let parsed: Record<string, unknown> = {};
  if (data.length > 0) {
    try {
      parsed = JSON.parse(data);
    } catch {
      // Non-JSON data is treated as an empty payload. This is intentional —
      // `prompt-response` and similar end-marker events may not carry data.
    }
  }

  switch (eventType) {
    case "response-chunk":
      return { type: "response-chunk", text: stringField(parsed, "text", "") };
    case "reasoning_delta":
      return {
        type: "reasoning_delta",
        text: stringField(parsed, "text", ""),
      };
    case "subagent-response-chunk":
      return {
        type: "subagent-response-chunk",
        agentId: stringField(parsed, "agentId", ""),
        text: stringField(parsed, "text", ""),
      };
    case "tool-call-request":
      return {
        type: "tool-call-request",
        id: stringField(parsed, "id", ""),
        name: stringField(parsed, "name", ""),
        arguments: parsed.arguments,
      };
    case "prompt-response":
      return { type: "prompt-response" };
    case "prompt-error":
      return {
        type: "prompt-error",
        code: optionalStringField(parsed, "code"),
        message: stringField(parsed, "message", "Unknown error"),
        countryBlockReason: optionalStringField(parsed, "countryBlockReason"),
      };
    default:
      // Unknown events are dropped on the floor. The transformer must be
      // forward-compatible with future Codebuff event additions.
      return null;
  }
}

function stringField(
  obj: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const v = obj[key];
  return typeof v === "string" ? v : fallback;
}

function optionalStringField(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
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

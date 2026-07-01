/**
 * Codebuff SSE parser.
 *
 * Reads a stream of UTF-8 chunks and emits typed Codebuff events:
 *   - response-chunk           → { chunk: string }
 *   - reasoning_delta          → { text: string, agentId?: string }
 *   - subagent-response-chunk  → { agentId, agentType?, chunk }
 *   - tool-call-request        → { toolName, toolCallId, input }
 *   - prompt-response          → { output: { type, value?, message?, statusCode?, error?, countryCode?, countryBlockReason?, ipPrivacySignals? } }
 *   - prompt-error             → { message, statusCode?, error?, countryCode?, countryBlockReason?, ipPrivacySignals? }
 *
 * SSE frames are separated by a blank line (`\n\n`). Within a frame:
 *   - `event:` lines declare the event type
 *   - `data:` lines carry a single JSON payload
 *   - `id:` lines are ignored
 *   - other lines are ignored
 *
 * @module lib/providers/freebuff/stream/parser
 */

export type CodebuffEvent =
  | { type: "response-chunk"; chunk: string }
  | {
      type: "reasoning_delta";
      text: string;
      agentId?: string;
    }
  | {
      type: "subagent-response-chunk";
      agentId: string;
      agentType?: string;
      chunk: string;
    }
  | {
      type: "tool-call-request";
      toolName: string;
      toolCallId: string;
      input: Record<string, unknown>;
      userInputId?: string;
    }
  | {
      type: "prompt-response";
      output: CodebuffPromptOutput;
    }
  | {
      type: "prompt-error";
      message: string;
      statusCode?: number;
      error?: string;
      countryCode?: string;
      countryBlockReason?: string;
      ipPrivacySignals?: string[];
    }
  | { type: "unknown"; raw: string };

export type CodebuffPromptOutput =
  | { type: "lastMessage"; value: CodebuffContentBlock[] }
  | { type: "allMessages"; value: CodebuffContentBlock[] }
  | { type: "structuredOutput"; value: Record<string, unknown> | null }
  | {
      type: "error";
      message: string;
      statusCode?: number;
      error?: string;
      countryCode?: string;
      countryBlockReason?: string;
      ipPrivacySignals?: string[];
    };

export type CodebuffContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: unknown }
  | { type: "thinking"; thinking: string }
  | { type: "media"; mediaType?: string; data?: string };

interface SseFrame {
  event?: string;
  data: string;
  id?: string;
}

/**
 * Stateful SSE buffer + line parser.
 */
export class SseLineBuffer {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const frame = parseSseFrame(rawFrame);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Flush any trailing (non-blank-terminated) frame at end-of-stream. */
  flush(): SseFrame[] {
    if (!this.buffer) return [];
    const frame = parseSseFrame(this.buffer);
    this.buffer = "";
    return frame ? [frame] : [];
  }
}

function parseSseFrame(raw: string): SseFrame | null {
  const lines = raw.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];
  let id: string | undefined;
  for (const line of lines) {
    if (line.startsWith(":")) continue; // SSE comment
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim();
    let value = line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    else if (field === "id") id = value;
  }
  if (dataLines.length === 0 && !event) return null;
  return { event, data: dataLines.join("\n"), id };
}

/**
 * Parse a single SSE data payload into a CodebuffEvent.
 * Returns `{ type: "unknown", raw }` when the payload is unrecognized.
 */
export function parseCodebuffEvent(payload: string): CodebuffEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { type: "unknown", raw: payload };
  }
  if (!parsed || typeof parsed !== "object") {
    return { type: "unknown", raw: payload };
  }
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case "response-chunk": {
      const chunk = typeof obj.chunk === "string" ? obj.chunk : "";
      return { type: "response-chunk", chunk };
    }
    case "reasoning_delta": {
      const text = typeof obj.text === "string" ? obj.text : "";
      return {
        type: "reasoning_delta",
        text,
        agentId: typeof obj.agentId === "string" ? obj.agentId : undefined,
      };
    }
    case "subagent-response-chunk": {
      return {
        type: "subagent-response-chunk",
        agentId: typeof obj.agentId === "string" ? obj.agentId : "unknown",
        agentType: typeof obj.agentType === "string" ? obj.agentType : undefined,
        chunk: typeof obj.chunk === "string" ? obj.chunk : "",
      };
    }
    case "tool-call-request": {
      return {
        type: "tool-call-request",
        toolName: typeof obj.toolName === "string" ? obj.toolName : "",
        toolCallId:
          typeof obj.toolCallId === "string"
            ? obj.toolCallId
            : typeof obj.requestId === "string"
              ? obj.requestId
              : "",
        input:
          obj.input && typeof obj.input === "object"
            ? (obj.input as Record<string, unknown>)
            : {},
        userInputId:
          typeof obj.userInputId === "string" ? obj.userInputId : undefined,
      };
    }
    case "prompt-response": {
      const output = obj.output && typeof obj.output === "object"
        ? (obj.output as Record<string, unknown>)
        : {};
      return {
        type: "prompt-response",
        output: normalizePromptOutput(output),
      };
    }
    case "prompt-error": {
      return {
        type: "prompt-error",
        message: typeof obj.message === "string" ? obj.message : "unknown error",
        statusCode:
          typeof obj.statusCode === "number" ? obj.statusCode : undefined,
        error: typeof obj.error === "string" ? obj.error : undefined,
        countryCode:
          typeof obj.countryCode === "string" ? obj.countryCode : undefined,
        countryBlockReason:
          typeof obj.countryBlockReason === "string"
            ? obj.countryBlockReason
            : undefined,
        ipPrivacySignals: Array.isArray(obj.ipPrivacySignals)
          ? (obj.ipPrivacySignals as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : undefined,
      };
    }
    default:
      return { type: "unknown", raw: payload };
  }
}

function normalizePromptOutput(obj: Record<string, unknown>): CodebuffPromptOutput {
  switch (obj.type) {
    case "lastMessage":
    case "allMessages": {
      const value = Array.isArray(obj.value)
        ? (obj.value as CodebuffContentBlock[])
        : [];
      return { type: obj.type, value };
    }
    case "structuredOutput": {
      const value =
        obj.value && typeof obj.value === "object"
          ? (obj.value as Record<string, unknown>)
          : null;
      return { type: "structuredOutput", value };
    }
    case "error": {
      return {
        type: "error",
        message: typeof obj.message === "string" ? obj.message : "unknown error",
        statusCode:
          typeof obj.statusCode === "number" ? obj.statusCode : undefined,
        error: typeof obj.error === "string" ? obj.error : undefined,
        countryCode:
          typeof obj.countryCode === "string" ? obj.countryCode : undefined,
        countryBlockReason:
          typeof obj.countryBlockReason === "string"
            ? obj.countryBlockReason
            : undefined,
        ipPrivacySignals: Array.isArray(obj.ipPrivacySignals)
          ? (obj.ipPrivacySignals as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : undefined,
      };
    }
    default:
      return { type: "error", message: "unrecognized output type" };
  }
}

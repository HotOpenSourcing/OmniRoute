/**
 * Anthropic Messages SSE transformer.
 *
 * Consumes a byte stream of Codebuff SSE events and emits Anthropic
 * `message_*` events in the canonical order:
 *
 *   message_start
 *   content_block_start  (one or more blocks: text, thinking, tool_use)
 *   content_block_delta  (zero or more per block)
 *   content_block_stop   (one per opened block)
 *   message_delta        (carries stop_reason and final usage)
 *   message_stop
 *
 * Block management:
 *   - At most one `thinking` block is opened (for reasoning deltas) and
 *     closed when the first non-reasoning event arrives or the stream
 *     ends.
 *   - At most one `text` block is opened (for response chunks) and
 *     closed the same way.
 *   - Tool calls become one `tool_use` block each; ids come from
 *     `event.toolCallId`.
 */

import type { TransformerOptions } from "./index.ts";
import {
  CodebuffSseParser,
  formatSseFrame,
  friendlyErrorMessage,
} from "./index.ts";
import type { CodebuffEvent } from "../events.ts";

interface AnthropicMessageStart {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: { input_tokens: 0; output_tokens: 0 };
  };
}

interface AnthropicContentBlockStartText {
  type: "content_block_start";
  index: number;
  content_block: { type: "text"; text: "" };
}

interface AnthropicContentBlockStartThinking {
  type: "content_block_start";
  index: number;
  content_block: { type: "thinking"; thinking: "" };
}

interface AnthropicContentBlockStartToolUse {
  type: "content_block_start";
  index: number;
  content_block: {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
}

interface AnthropicContentBlockDeltaText {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
}

interface AnthropicContentBlockDeltaThinking {
  type: "content_block_delta";
  index: number;
  delta: { type: "thinking_delta"; thinking: string };
}

interface AnthropicContentBlockDeltaToolUse {
  type: "content_block_delta";
  index: number;
  delta: { type: "input_json_delta"; partial_json: string };
}

interface AnthropicContentBlockStop {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDelta {
  type: "message_delta";
  delta: { stop_reason: "end_turn" | "tool_use"; stop_sequence: null };
  usage: { output_tokens: number };
}

interface AnthropicMessageStop {
  type: "message_stop";
}

interface AnthropicErrorFrame {
  type: "error";
  error: {
    type: "country_blocked" | "rate_limited" | "upstream_error";
    message: string;
  };
}

const STOP = "stop_reason";
const TOOL_USE = "tool_use";

export function createAnthropicTransformer(
  options: TransformerOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parser = new CodebuffSseParser();
  const messageId = `msg_${cryptoRandomUUID()}`;

  let started = false;
  let thinkingIndex: number | null = null;
  let textIndex: number | null = null;
  let nextIndex = 0;
  let outputTokens = 0;
  let sawToolCall = false;
  let closed = false;

  function frame(payload: object, event = ""): string {
    return formatSseFrame({ event, data: JSON.stringify(payload) });
  }

  function ensureMessageStart(): string | null {
    if (started) return null;
    started = true;
    const start: AnthropicMessageStart = {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model: options.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    };
    return frame(start, "message_start");
  }

  function openThinkingBlock(): string {
    thinkingIndex = nextIndex++;
    const start: AnthropicContentBlockStartThinking = {
      type: "content_block_start",
      index: thinkingIndex,
      content_block: { type: "thinking", thinking: "" },
    };
    return frame(start, "content_block_start");
  }

  function closeThinkingBlock(): string | null {
    if (thinkingIndex === null) return null;
    const stop: AnthropicContentBlockStop = {
      type: "content_block_stop",
      index: thinkingIndex,
    };
    const idx = thinkingIndex;
    thinkingIndex = null;
    return frame(stop, "content_block_stop") + `__INDEX_CLOSED__${idx}`;
  }

  function emitThinkingDelta(text: string): string {
    if (thinkingIndex === null) {
      return openThinkingBlock() +
        frame(
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: text },
          } satisfies AnthropicContentBlockDeltaThinking,
          "content_block_delta",
        );
    }
    return frame(
      {
        type: "content_block_delta",
        index: thinkingIndex,
        delta: { type: "thinking_delta", thinking: text },
      },
      "content_block_delta",
    );
  }

  function openTextBlock(): string {
    textIndex = nextIndex++;
    const start: AnthropicContentBlockStartText = {
      type: "content_block_start",
      index: textIndex,
      content_block: { type: "text", text: "" },
    };
    return frame(start, "content_block_start");
  }

  function closeTextBlock(): string | null {
    if (textIndex === null) return null;
    const stop: AnthropicContentBlockStop = {
      type: "content_block_stop",
      index: textIndex,
    };
    const idx = textIndex;
    textIndex = null;
    return frame(stop, "content_block_stop") + `__INDEX_CLOSED__${idx}`;
  }

  function emitTextDelta(text: string): string {
    if (textIndex === null) {
      return openTextBlock() +
        frame(
          {
            type: "content_block_delta",
            index: nextIndex - 1,
            delta: { type: "text_delta", text },
          } satisfies AnthropicContentBlockDeltaText,
          "content_block_delta",
        );
    }
    return frame(
      {
        type: "content_block_delta",
        index: textIndex,
        delta: { type: "text_delta", text },
      },
      "content_block_delta",
    );
  }

  function emitToolCall(event: Extract<CodebuffEvent, { type: "tool-call" }>): string {
    sawToolCall = true;
    const blockIndex = nextIndex++;
    const start: AnthropicContentBlockStartToolUse = {
      type: "content_block_start",
      index: blockIndex,
      content_block: {
        type: "tool_use",
        id: event.toolCallId,
        name: event.toolName,
        input:
          event.input === null || typeof event.input !== "object"
            ? {}
            : (event.input as Record<string, unknown>),
      },
    };
    const partial =
      event.input === undefined
        ? ""
        : typeof event.input === "string"
          ? event.input
          : JSON.stringify(event.input);
    const delta: AnthropicContentBlockDeltaToolUse = {
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "input_json_delta", partial_json: partial },
    };
    const stop: AnthropicContentBlockStop = {
      type: "content_block_stop",
      index: blockIndex,
    };
    return (
      frame(start, "content_block_start") +
      frame(delta, "content_block_delta") +
      frame(stop, "content_block_stop")
    );
  }

  function emitTail(reason: "end_turn" | "tool_use"): string {
    let out = "";
    out += closeThinkingBlock() ?? "";
    out += closeTextBlock() ?? "";
    const delta: AnthropicMessageDelta = {
      type: "message_delta",
      delta: { stop_reason: reason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    };
    out += frame(delta, "message_delta");
    out += frame({ type: "message_stop" } satisfies AnthropicMessageStop, "message_stop");
    return out;
  }

  function emitError(event: Extract<CodebuffEvent, { type: "prompt-error" }>): string {
    const err: AnthropicErrorFrame = {
      type: "error",
      error: {
        type: event.countryBlockReason
          ? "country_blocked"
          : event.code === "rate_limited"
            ? "rate_limited"
            : "upstream_error",
        message: friendlyErrorMessage(event),
      },
    };
    return frame(err, "error");
  }

  function handle(event: CodebuffEvent): string | null {
    if (closed) return null;
    const prelude = ensureMessageStart() ?? "";

    switch (event.type) {
      case "reasoning_delta": {
        if (!event.text) return null;
        outputTokens += approximateTokens(event.text);
        return prelude + emitThinkingDelta(event.text);
      }

      case "response-chunk": {
        if (!event.text) return null;
        outputTokens += approximateTokens(event.text);
        return prelude + emitTextDelta(event.text);
      }

      case "tool-call": {
        outputTokens += approximateTokens(event.toolName);
        return prelude + emitToolCall(event);
      }

      case "subagent-response-chunk": {
        if (!options.includeSubagentOutput) return null;
        outputTokens += approximateTokens(event.text);
        return prelude + emitTextDelta(`[sub-agent:${event.agentId}] ${event.text}`);
      }

      case "prompt-error": {
        closed = true;
        return prelude + emitError(event);
      }

      case "prompt-response": {
        closed = true;
        return prelude + emitTail(sawToolCall ? TOOL_USE : STOP);
      }

      default:
        return null;
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      const events = parser.push(decoder.decode(chunk, { stream: true }));
      for (const event of events) {
        const out = handle(event);
        if (out) controller.enqueue(encoder.encode(out));
        if (closed) {
          controller.terminate();
          return;
        }
      }
    },
    flush(controller) {
      const remaining = parser.flush();
      for (const event of remaining) {
        const out = handle(event);
        if (out) controller.enqueue(encoder.encode(out));
      }
      if (!closed && started) {
        controller.enqueue(encoder.encode(emitTail(sawToolCall ? TOOL_USE : STOP)));
      }
    },
  });
}

function approximateTokens(text: string): number {
  // Rough heuristic — 4 chars per token. Anthropic's billing counts
  // tokens not chars, but for usage reporting this approximation is
  // close enough and avoids pulling in a tokenizer on the hot path.
  return Math.max(1, Math.ceil(text.length / 4));
}

function cryptoRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? require("crypto").webcrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

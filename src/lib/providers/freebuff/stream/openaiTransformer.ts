/**
 * OpenAI Chat Completions SSE transformer.
 *
 * Consumes a byte stream of Codebuff SSE events and emits OpenAI
 * `chat.completion.chunk` frames terminated by `data:n\n\n`.
 *
 * Output shape per `CodebuffEvent`:
 *
 *   reasoning_delta         → delta.reasoning_content
 *   response-chunk (text)   → delta.content
 *   tool-call               → delta.tool_calls[]
 *   prompt-error            → { error: { message, type, code } } then close
 *   prompt-response         → `data:n\n\n`
 *
 * The transformer emits the role announcement chunk lazily on the first
 * non-empty content delta so consumers never see an empty assistant
 * turn.
 */

import type { TransformerOptions } from "./index.ts";
import {
  CodebuffSseParser,
  formatSseFrame,
  friendlyErrorMessage,
} from "./index.ts";
import type { CodebuffEvent } from "../events.ts";

interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: 0;
    delta: Record<string, unknown>;
    finish_reason: "stop" | "tool_calls" | null;
  }>;
}

interface OpenAIErrorChunk {
  error: {
    message: string;
    type: string;
    code?: string;
  };
}

export function createOpenAITransformer(
  options: TransformerOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const parser = new CodebuffSseParser();
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${cryptoRandomUUID()}`;

  let announced = false;
  let closed = false;
  let sawToolCall = false;

  function chunk(payload: Partial<OpenAIChatChunk>): string {
    const full: OpenAIChatChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model: options.model,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      ...payload,
    };
    return formatSseFrame({ data: JSON.stringify(full) });
  }

  function announceIfNeeded(): string | null {
    if (announced) return null;
    announced = true;
    return chunk({
      choices: [
        { index: 0, delta: { role: "assistant", content: "" }, finish_reason: null },
      ],
    });
  }

  function errorFrame(event: Extract<CodebuffEvent, { type: "prompt-error" }>): string {
    const payload: OpenAIErrorChunk = {
      error: {
        message: friendlyErrorMessage(event),
        type: event.countryBlockReason
          ? "country_blocked"
          : event.code ?? "upstream_error",
        ...(event.code ? { code: event.code } : {}),
      },
    };
    return formatSseFrame({ data: JSON.stringify(payload) });
  }

  function doneFrame(): string {
    return "data:n\n\n";
  }

  function handle(event: CodebuffEvent): string | null {
    if (closed) return null;

    switch (event.type) {
      case "reasoning_delta": {
        if (!event.text) return null;
        const prelude = announceIfNeeded();
        const body = chunk({
          choices: [
            { index: 0, delta: { reasoning_content: event.text }, finish_reason: null },
          ],
        });
        return prelude ? prelude + body : body;
      }

      case "response-chunk": {
        if (!event.text) return null;
        const prelude = announceIfNeeded();
        const body = chunk({
          choices: [
            { index: 0, delta: { content: event.text }, finish_reason: null },
          ],
        });
        return prelude ? prelude + body : body;
      }

      case "tool-call": {
        sawToolCall = true;
        const prelude = announceIfNeeded();
        const toolCallDelta = {
          index: 0,
          id: event.toolCallId,
          type: "function" as const,
          function: {
            name: event.toolName,
            arguments:
              event.input === undefined
                ? ""
                : typeof event.input === "string"
                  ? event.input
                  : JSON.stringify(event.input),
          },
        };
        const body = chunk({
          choices: [
            { index: 0, delta: { tool_calls: [toolCallDelta] }, finish_reason: null },
          ],
        });
        return prelude ? prelude + body : body;
      }

      case "subagent-response-chunk": {
        if (!options.includeSubagentOutput) return null;
        const prelude = announceIfNeeded();
        const body = chunk({
          choices: [
            {
              index: 0,
              delta: { content: `[sub-agent:${event.agentId}] ${event.text}` },
              finish_reason: null,
            },
          ],
        });
        return prelude ? prelude + body : body;
      }

      case "prompt-error": {
        closed = true;
        const err = errorFrame(event);
        return err + doneFrame();
      }

      case "prompt-response": {
        closed = true;
        const tail = announceIfNeeded()
          ? chunk({
              choices: [{ index: 0, delta: {}, finish_reason: sawToolCall ? "tool_calls" : "stop" }],
            })
          : "";
        return tail + doneFrame();
      }

      default:
        return null;
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      const events = parser.push(decoder.decode(chunk, { stream: true }));
      for (const event of events) {
        const frame = handle(event);
        if (frame) controller.enqueue(encoder.encode(frame));
        if (closed) {
          controller.terminate();
          return;
        }
      }
    },
    flush(controller) {
      const remaining = parser.flush();
      for (const event of remaining) {
        const frame = handle(event);
        if (frame) controller.enqueue(encoder.encode(frame));
      }
    },
  });
}

/** UUID v4 using crypto.randomUUID when available, with a tiny fallback. */
function cryptoRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC 4122 v4 fallback — only reached in ancient environments.
  const bytes = new Uint8Array(16);
  (globalThis.crypto ?? require("crypto").webcrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * Freebuff (Codebuff) SSE event schemas — Chunk 1.
 *
 * SOURCE OF TRUTH
 * ---------------
 * These schemas are derived from a binary inspection of
 * `~/.config/manicode/freebuff.exe` (v0.0.115, May 2026) using
 * `strings` and pattern matching on the JS bundle embedded in the
 * bun-compiled binary. The Chunk 5 transformer and the Chunk 4
 * provider consume this module as the single source of truth.
 *
 * Each schema is tagged `confirmed` (observed verbatim in the binary)
 * or `spec-derived` (inferred from the Freebuff chunked spec because
 * the literal event name was not found in the client binary).
 *
 * BINARY vs SPEC DISCREPANCY
 * --------------------------
 * The chunked spec assumed the following event names on the wire:
 *
 *   response-chunk, reasoning_delta, subagent-response-chunk,
 *   tool-call-request, prompt-response, prompt-error
 *
 * Direct inspection of `freebuff.exe` confirms ONLY `reasoning_delta`
 * as a wire-level event type. The client emits internal chunk types
 * (`text`, `reasoning`, `tool-call`, `error`) which the server then
 * reflects back. Several field names differ from the spec — the most
 * notable is tool calls, where the binary uses `toolCallId` / `toolName`
 * / `input` instead of the spec's `id` / `name` / `arguments`.
 *
 * Until network capture of a live Codebuff run confirms otherwise, the
 * `spec-derived` entries below are best-effort guesses and **must be
 * recalibrated** when real wire data becomes available.
 */

import { z } from "zod";
import { freebuffUuidSchema } from "@/shared/schemas/providers/freebuff";

// ---------------------------------------------------------------------------
// Shared building blocks.
// ---------------------------------------------------------------------------

/** UUID — matches the identifiers observed in the Codebuff binary. */
export const codebuffUuidSchema = freebuffUuidSchema;

/** Confirmed wire shape for the `reasoning_delta` event. */
export const reasoningDeltaEventSchema = z.object({
  type: z.literal("reasoning_delta"),
  text: z.string(),
  /** Chain of run ids — used to scope reasoning to a specific agent call. */
  ancestorRunIds: z.array(codebuffUuidSchema),
  /** Current run id (unique per `agent-runs` POST). */
  runId: codebuffUuidSchema,
  /** Agent instance that produced the reasoning chunk. */
  agentId: z.string().min(1),
});
export type ReasoningDeltaEvent = z.infer<typeof reasoningDeltaEventSchema>;

// ---------------------------------------------------------------------------
// Tool-call event.
// ---------------------------------------------------------------------------

/**
 * Confirmed shape for tool-call events emitted by the client.
 *
 * Field names are taken verbatim from the binary's `T()` function
 * (`onTagEnd` callback in the bundle):
 *
 *     let { toolName, contents } = K, { input } = K;
 *
 * The spec called these `name` / `arguments` — that mapping was wrong.
 */
export const toolCallEventSchema = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  input: z.unknown(),
  /** Optional raw payload the tool produced (XML-style content). */
  contents: z.string().optional(),
});
export type ToolCallEvent = z.infer<typeof toolCallEventSchema>;

// ---------------------------------------------------------------------------
// Spec-derived events — flagged for recalibration.
// ---------------------------------------------------------------------------

/**
 * SPEC-DERIVED — NOT CONFIRMED in binary.
 *
 * The spec assumed text chunks are wrapped in a `response-chunk` event
 * with a `.text` field. The binary instead emits raw text strings
 * (`M(C.text)` in the bundle) without an event wrapper. Both shapes are
 * accepted here to remain forward-compatible.
 */
export const responseChunkEventSchema = z.union([
  // Observed in binary: raw text without wrapper.
  z.string().transform((text) => ({ type: "response-chunk" as const, text })),
  // Spec-derived: wrapped event.
  z.object({
    type: z.literal("response-chunk"),
    text: z.string(),
  }),
]);
export type ResponseChunkEvent = z.infer<typeof responseChunkEventSchema>;

/**
 * SPEC-DERIVED — NOT CONFIRMED in binary.
 *
 * No `subagent-response-chunk` string was found in the binary. The spec
 * describes this event as carrying text emitted by a spawned sub-agent.
 * The closest observation is `agentId` being passed alongside
 * `reasoning_delta`, suggesting the server may emit a similar shape for
 * sub-agent text. Both `agentId` and `text` are required by the spec.
 */
export const subagentResponseChunkEventSchema = z.object({
  type: z.literal("subagent-response-chunk"),
  agentId: z.string().min(1),
  text: z.string(),
});
export type SubagentResponseChunkEvent = z.infer<
  typeof subagentResponseChunkEventSchema
>;

/**
 * SPEC-DERIVED — NOT CONFIRMED in binary.
 *
 * The binary uses `tool-call` internally (see `toolCallEventSchema`
 * above). The spec called this `tool-call-request`. Both shapes are
 * accepted; the spec-derived variant maps `id`→`toolCallId`,
 * `name`→`toolName`, `arguments`→`input`.
 */
export const toolCallRequestEventSchema = z.union([
  // Observed in binary.
  toolCallEventSchema,
  // Spec-derived alias.
  z
    .object({
      type: z.literal("tool-call-request"),
      id: z.string().min(1),
      name: z.string().min(1),
      arguments: z.unknown(),
    })
    .transform((v) => ({
      type: "tool-call" as const,
      toolCallId: v.id,
      toolName: v.name,
      input: v.arguments,
    })),
]);
export type ToolCallRequestEvent = z.infer<typeof toolCallRequestEventSchema>;

/**
 * SPEC-DERIVED — NOT CONFIRMED in binary.
 *
 * The spec described `prompt-response` as an end-of-stream marker with
 * no payload. No literal string was found in the binary. We accept both
 * the bare marker and a payload-less variant.
 */
export const promptResponseEventSchema = z
  .union([
    z.literal("prompt-response"),
    z.object({ type: z.literal("prompt-response") }),
    z.null(),
  ])
  .transform(() => ({ type: "prompt-response" as const }));
export type PromptResponseEvent = z.infer<typeof promptResponseEventSchema>;

/**
 * SPEC-DERIVED — NOT CONFIRMED in binary.
 *
 * The binary emits `error` chunks with at minimum a `message` field.
 * The spec additionally named `code` and `countryBlockReason` fields
 * for typed error handling. Both shapes are accepted — the spec-derived
 * fields are optional, allowing binary-shaped errors to validate.
 */
export const promptErrorEventSchema = z.union([
  // Observed in binary: at least `message`.
  z
    .object({
      message: z.string().min(1),
      code: z.string().optional(),
      countryBlockReason: z.string().optional(),
    })
    .transform((v) => ({
      type: "prompt-error" as const,
      message: v.message,
      code: v.code,
      countryBlockReason: v.countryBlockReason,
    })),
  // Spec-derived: explicit `type` field.
  z.object({
    type: z.literal("prompt-error"),
    message: z.string(),
    code: z.string().optional(),
    countryBlockReason: z.string().optional(),
  }),
]);
export type PromptErrorEvent = z.infer<typeof promptErrorEventSchema>;

// ---------------------------------------------------------------------------
// Union of all events.
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every Codebuff SSE event the OmniRoute provider
 * handles. Exhaustive — `parseCodebuffEvent` uses this union to validate
 * payloads and produce typed objects for the Chunk 5 transformer.
 */
export const codebuffEventSchema = z.discriminatedUnion("type", [
  reasoningDeltaEventSchema,
  subagentResponseChunkEventSchema,
  toolCallEventSchema,
  z.object({
    type: z.literal("response-chunk"),
    text: z.string(),
  }),
  z.object({ type: z.literal("prompt-response") }),
  z.object({
    type: z.literal("prompt-error"),
    message: z.string(),
    code: z.string().optional(),
    countryBlockReason: z.string().optional(),
  }),
]);
export type CodebuffEvent = z.infer<typeof codebuffEventSchema>;

// ---------------------------------------------------------------------------
// Parser.
// ---------------------------------------------------------------------------

/**
 * Parses a raw Codebuff event payload (post SSE framing) into a typed
 * event. Accepts both binary-observed and spec-derived shapes; the
 * result is normalised to the canonical internal representation.
 */
export function parseCodebuffEvent(input: unknown): CodebuffEvent {
  if (typeof input === "string") {
    // Spec-derived end-of-stream marker.
    if (input === "prompt-response") {
      return { type: "prompt-response" };
    }
    // Binary-observed shape: text chunks are raw strings.
    return { type: "response-chunk", text: input };
  }
  if (input === null) {
    return { type: "prompt-response" };
  }
  if (typeof input !== "object") {
    throw new Error(`Invalid Codebuff event payload: ${typeof input}`);
  }

  const obj = input as Record<string, unknown>;

  // Reasoning delta — confirmed shape.
  if (
    obj.type === "reasoning_delta" &&
    typeof obj.text === "string" &&
    Array.isArray(obj.ancestorRunIds) &&
    typeof obj.runId === "string" &&
    typeof obj.agentId === "string"
  ) {
    return reasoningDeltaEventSchema.parse(obj);
  }

  // Tool call — confirmed shape (binary uses these field names).
  if (obj.type === "tool-call") {
    return toolCallEventSchema.parse(obj);
  }

  // Tool call request — spec-derived alias (id/name/arguments).
  if (obj.type === "tool-call-request") {
    return toolCallRequestEventSchema.parse(obj);
  }

  // Response chunk — spec-derived wrapped shape.
  if (obj.type === "response-chunk" && typeof obj.text === "string") {
    return { type: "response-chunk", text: obj.text };
  }

  // Sub-agent response chunk — spec-derived.
  if (
    obj.type === "subagent-response-chunk" &&
    typeof obj.agentId === "string" &&
    typeof obj.text === "string"
  ) {
    return subagentResponseChunkEventSchema.parse(obj);
  }

  // Prompt response — end marker.
  if (obj.type === "prompt-response") {
    return { type: "prompt-response" };
  }

  // Prompt error — confirmed or spec-derived.
  if (obj.type === "prompt-error" || typeof obj.message === "string") {
    return promptErrorEventSchema.parse(input);
  }

  throw new Error(
    `Unrecognised Codebuff event shape: ${JSON.stringify(Object.keys(obj))}`,
  );
}

/** Convenience: parse and throw a typed error on failure. */
export function safeParseCodebuffEvent(input: unknown) {
  try {
    return { ok: true as const, event: parseCodebuffEvent(input) };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

/**
 * Tool-call delta helpers.
 *
 * Codebuff emits `tool-call-request` events. In the proprietary stream
 * each event carries the FULL tool call (id, name, arguments) — not
 * deltas. For OpenAI / Anthropic streaming we still want a delta-shaped
 * payload so clients can render tool calls incrementally.
 *
 * These helpers split a full Codebuff tool-call-request into:
 *
 *   - a "header" delta (id + name) emitted once per call
 *   - an "arguments" delta emitted as JSON text. Arguments may be a string
 *     or an object — we normalize to string for the wire format.
 *
 * The transformers call `startToolCall()` on first sight of an id, then
 * `appendToolCallArguments()` if the same id reappears with additional
 * args (defensive — Codebuff currently emits single-shot tool calls, but
 * the spec leaves room for incremental emission).
 */

export interface ToolCallRecord {
  /** 0-based index within the current assistant message. */
  index: number;
  id: string;
  name: string;
  /** Accumulated JSON string of arguments. */
  argumentsJson: string;
  /** True once the arguments payload has been fully emitted. */
  completed: boolean;
}

export interface ToolCallState {
  /** Ordered list of tool calls in this assistant message. */
  calls: ToolCallRecord[];
  /** id → index in `calls`, for O(1) lookup of repeated ids. */
  byId: Map<string, number>;
}

export function createToolCallState(): ToolCallState {
  return { calls: [], byId: new Map() };
}

/**
 * Start (or look up) a tool call by id. Returns the record so the caller
 * can emit the header delta.
 */
export function startToolCall(
  state: ToolCallState,
  id: string,
  name: string,
): ToolCallRecord {
  const existing = state.byId.get(id);
  if (existing !== undefined) {
    const record = state.calls[existing];
    // Defensive: if the name changed, update it.
    if (record.name !== name) {
      const updated = { ...record, name };
      state.calls[existing] = updated;
      return updated;
    }
    return record;
  }

  const record: ToolCallRecord = {
    index: state.calls.length,
    id,
    name,
    argumentsJson: "",
    completed: false,
  };
  state.calls.push(record);
  state.byId.set(id, record.index);
  return record;
}

/**
 * Append arguments to a previously-started tool call. `argumentsRaw` may
 * be a string (already JSON-encoded) or an object/array (will be
 * JSON-stringified here). Returns the new accumulated JSON.
 *
 * Returns an empty string when the id is unknown so the caller can no-op.
 */
export function appendToolCallArguments(
  state: ToolCallState,
  id: string,
  argumentsRaw: unknown,
): string {
  const idx = state.byId.get(id);
  if (idx === undefined) return "";
  const record = state.calls[idx];
  const next =
    typeof argumentsRaw === "string"
      ? argumentsRaw
      : argumentsRaw === undefined
        ? ""
        : JSON.stringify(argumentsRaw);
  record.argumentsJson += next;
  record.completed = true;
  return record.argumentsJson;
}

/**
 * Convenience for the OpenAI wire format. Returns the `tool_calls` array
 * fragment for a single chunk. Pass `delta: true` to emit the header
 * (id+name), `delta: false` to emit only arguments.
 */
export function openAiToolCallChunk(
  record: ToolCallRecord,
  delta: boolean,
): {
  index: number;
  id?: string;
  type: "function";
  function: { name?: string; arguments: string };
} {
  return {
    index: record.index,
    ...(delta ? { id: record.id, type: "function" as const } : {}),
    function: {
      ...(delta ? { name: record.name } : {}),
      arguments: record.argumentsJson,
    },
  };
}

/** Convenience for the Anthropic wire format — returns the tool_use block. */
export function anthropicToolUseBlock(record: ToolCallRecord): {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
} {
  let input: unknown = {};
  if (record.argumentsJson.length > 0) {
    try {
      input = JSON.parse(record.argumentsJson);
    } catch {
      // Malformed JSON — surface as a string rather than failing the stream.
      input = { _raw: record.argumentsJson };
    }
  }
  return { type: "tool_use", id: record.id, name: record.name, input };
}

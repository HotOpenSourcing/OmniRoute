/**
 * Reasoning-delta helpers.
 *
 * Both the OpenAI and Anthropic transformers emit `reasoning_delta` events
 * from Codebuff as a dedicated "thinking" block:
 *
 *   - OpenAI (o1-style): `delta.reasoning_content` on the same choice
 *     chunk that carries normal content. We don't open a separate block
 *     because OpenAI's spec doesn't have one.
 *
 *   - Anthropic: a `content_block` of type `thinking`, opened once and
 *     fed with `thinking_delta` deltas. Closed when reasoning ends or when
 *     regular text begins.
 *
 * These helpers centralise the buffer / lifecycle logic so the two
 * transformers stay symmetric and easy to test.
 */

export interface ReasoningState {
  /** True once at least one reasoning_delta has been observed. */
  started: boolean;
  /** True after a `content_block_stop` (Anthropic) or final marker was emitted. */
  closed: boolean;
  /** Accumulated text — useful for debug logging and tests. */
  accumulated: string;
}

/** Create a fresh reasoning state. */
export function createReasoningState(): ReasoningState {
  return { started: false, closed: false, accumulated: "" };
}

/** Append a Codebuff reasoning_delta to the state and return the new text. */
export function appendReasoning(
  state: ReasoningState,
  delta: string,
): { newState: ReasoningState; delta: string } {
  if (state.closed) {
    // Ignore late deltas — once reasoning closed, the model is emitting text
    // or tool calls. This is defensive against buggy upstream streams.
    return { newState: state, delta: "" };
  }
  return {
    newState: {
      ...state,
      started: true,
      accumulated: state.accumulated + delta,
    },
    delta,
  };
}

/** Mark reasoning as closed (after final reasoning_delta or before text). */
export function closeReasoning(
  state: ReasoningState,
): ReasoningState {
  return { ...state, closed: true };
}

/** Convenience: total characters accumulated. */
export function reasoningLength(state: ReasoningState): number {
  return state.accumulated.length;
}

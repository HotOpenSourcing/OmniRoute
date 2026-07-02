/**
 * SSE pass-through transformer.
 *
 * Codebuff/Freebuff upstream emits standard OpenAI chat-completion SSE
 * chunks. This transformer relays the bytes verbatim to the caller.
 *
 * Use this for the standard /api/v1/chat/completions endpoint. The
 * custom Codebuff-event parsers in `openaiTransformer.ts` and
 * `anthropicTransformer.ts` are kept as legacy references but should
 * not be wired to the live provider.
 *
 * @module lib/providers/freebuff/stream/passthroughTransformer
 */

export interface PassThroughOptions {
  /** Surface forwarded as-is — currently unused. Reserved for future
   *  per-format tweaks (e.g. injection of usage annotations). */
  model?: string;
  includeSubagentOutput?: boolean;
}

export function createPassthroughTransformer(
  _options: PassThroughOptions = {},
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });
}

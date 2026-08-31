/**
 * Freebuff CLI Emulator — SSE Parser
 *
 * Wraps and re-exports the canonical `CodebuffSseParser` from the stream
 * module to ensure 100% feature and bug parity, while exposing it
 * under the cliEmulator namespace.
 *
 * @module lib/providers/freebuff/cliEmulator/sseParser
 */

import { CodebuffSseParser as StreamParser } from "../stream/index.ts";
import type { CodebuffEvent } from "../events.ts";

export class CodebuffSseParser extends StreamParser {}

/**
 * Convenience helper: parse a complete SSE stream (already buffered as
 * a single string) into typed events. Mostly useful for tests.
 */
export function parseSseStream(text: string): CodebuffEvent[] {
  const parser = new CodebuffSseParser();
  const events = parser.push(text);
  return events.concat(parser.flush());
}

export type { CodebuffEvent } from "../events.ts";

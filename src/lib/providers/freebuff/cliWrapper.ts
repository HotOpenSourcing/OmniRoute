/**
 * Freebuff CLI Wrapper — Real CLI Invocation
 *
 * This module wraps the actual Freebuff CLI binary installed at
 * `~/.config/manicode/freebuff.exe` (Windows) or `~/.config/manicode/freebuff`
 * (Unix) instead of emulating it.
 *
 * The wrapper spawns the binary as a child process and pipes the SSE stream
 * back to the caller. Authentication is handled via environment variables.
 *
 * @module lib/providers/freebuff/cliWrapper
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { FreebuffCredentials, FreebuffChatInput } from "./cliEmulator/types.ts";

/**
 * Resolve the path to the installed Freebuff binary.
 */
export function getFreebuffBinaryPath(): string {
  const configDir = join(homedir(), ".config", "manicode");
  const binaryName = platform() === "win32" ? "freebuff.exe" : "freebuff";
  return join(configDir, binaryName);
}

/**
 * Check whether the Freebuff CLI is installed.
 */
export function isFreebuffCliInstalled(): boolean {
  return existsSync(getFreebuffBinaryPath());
}

/**
 * Invoke the Freebuff CLI for a chat completion request.
 *
 * The binary is spawned with stdin/stdout piped. Messages are written to
 * stdin as JSON Lines, and the SSE stream is read from stdout.
 *
 * @param input - Chat completion input (model, messages, stream, etc.)
 * @param credentials - Freebuff authentication credentials
 * @returns A ReadableStream of SSE chunks from the CLI
 */
export async function invokeFreebuffCli(
  input: FreebuffChatInput,
  credentials: FreebuffCredentials,
): Promise<ReadableStream<Uint8Array>> {
  const binaryPath = getFreebuffBinaryPath();
  if (!existsSync(binaryPath)) {
    throw new Error(
      `Freebuff CLI not found at ${binaryPath}. Install it with: npm i -g freebuff`,
    );
  }

  // Build CLI args: --model <model> [--stream]
  const args: string[] = [];
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.stream !== false) {
    args.push("--stream");
  }

  // Spawn the binary with auth env vars
  const child = spawn(binaryPath, args, {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      CODEBUFF_AUTH_TOKEN: credentials.authToken,
      CODEBUFF_FINGERPRINT_ID: credentials.fingerprintId,
      ...(credentials.fingerprintHash
        ? { CODEBUFF_FINGERPRINT_HASH: credentials.fingerprintHash }
        : {}),
    },
  });

  // Write messages to stdin (JSON Lines format expected by CLI)
  for (const msg of input.messages) {
    child.stdin.write(JSON.stringify(msg) + "\n");
  }
  child.stdin.end();

  // Convert stdout to a ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      child.stdout.on("end", () => {
        controller.close();
      });

      child.stdout.on("error", (err: Error) => {
        controller.error(err);
      });

      child.on("error", (err: Error) => {
        controller.error(err);
      });

      child.on("exit", (code: number | null) => {
        if (code !== null && code !== 0) {
          controller.error(new Error(`Freebuff CLI exited with code ${code}`));
        }
      });
    },

    cancel() {
      // Kill the child process if the stream is cancelled
      child.kill("SIGTERM");
    },
  });

  return stream;
}

#!/usr/bin/env node
/**
 * Freebuff CLI — long-lived REPL probe.
 *
 * Goal: keep stdin open for several seconds, write one prompt, and observe
 * whether the CLI streams anything to stdout while still alive.
 *
 * Lessons from prior probe:
 *   - exit code 33947855 = STATUS_CONTROL_C_EXIT (Windows kill signature)
 *   - the CLI may need stdin to stay open (don't end() it immediately)
 *   - flush() may trigger TTY tear-down on Windows
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import process from "node:process";

const binaryName = platform() === "win32" ? "freebuff.exe" : "freebuff";
const binaryPath = join(homedir(), ".config", "manicode", binaryName);
const credsPath = join(homedir(), ".config", "manicode", "credentials.json");

if (!existsSync(binaryPath)) {
  console.error(`[probe] binary not found: ${binaryPath}`);
  process.exit(1);
}

const creds = JSON.parse(readFileSync(credsPath, "utf8")).default;
console.log(`[probe] creds loaded: ${creds.email}`);
console.log(`[probe] binary: ${binaryPath}`);

function runWithEnv(label, args, stdinChunks, options = {}) {
  const { timeoutMs = 25000, cwd = process.cwd(), keepStdinOpen = true } = options;

  return new Promise((resolve) => {
    console.log(`\n=== ${label} ===`);
    console.log(`[probe] argv: freebuff ${args.join(" ")}`);

    const env = {
      ...process.env,
      CODEBUFF_AUTH_TOKEN: creds.authToken,
      CODEBUFF_FINGERPRINT_ID: creds.fingerprintId,
      CODEBUFF_FINGERPRINT_HASH: creds.fingerprintHash,
      CODEBUFF_USER_EMAIL: creds.email,
    };

    const child = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd,
      windowsHide: true,
    });

    let stdoutBufs = [];
    let stderrBufs = [];
    let totalStdout = 0;
    let totalStderr = 0;

    const start = Date.now();
    let firstStdoutAt = null;

    const log = (msg) => {
      const t = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`[probe t+${t}s] ${msg}`);
    };

    child.stdout.on("data", (chunk) => {
      stdoutBufs.push({ t: Date.now() - start, chunk });
      totalStdout += chunk.length;
      if (firstStdoutAt === null) firstStdoutAt = Date.now() - start;
      log(`stdout: +${chunk.length} bytes (total ${totalStdout})`);
      const preview = chunk.toString("utf8").slice(0, 200).replace(/\n/g, "\\n");
      log(`  preview: ${JSON.stringify(preview)}`);
    });
    child.stderr.on("data", (chunk) => {
      stderrBufs.push({ t: Date.now() - start, chunk });
      totalStderr += chunk.length;
      log(`stderr: +${chunk.length} bytes (total ${totalStderr})`);
      const preview = chunk.toString("utf8").slice(0, 400).replace(/\n/g, "\\n");
      log(`  preview: ${JSON.stringify(preview)}`);
    });

    child.on("exit", (code, signal) => {
      log(`EXIT code=${code} signal=${signal}`);
      log(`total stdout: ${totalStdout} bytes`);
      log(`total stderr: ${totalStderr} bytes`);
      if (firstStdoutAt !== null) {
        log(`first stdout at: t+${firstStdoutAt}ms`);
      } else {
        log(`first stdout: NEVER`);
      }
      if (stdoutBufs.length > 0) {
        console.log(`--- raw stdout concat (${totalStdout} bytes) ---`);
        const concat = Buffer.concat(stdoutBufs.map((b) => b.chunk));
        process.stdout.write(concat);
        console.log(`\n--- end stdout ---`);
      }
      if (stderrBufs.length > 0) {
        console.log(`--- raw stderr concat (${totalStderr} bytes) ---`);
        const concat = Buffer.concat(stderrBufs.map((b) => b.chunk));
        process.stdout.write(concat);
        console.log(`\n--- end stderr ---`);
      }
      resolve({ code, signal, totalStdout, totalStderr });
    });

    let cancelled = false;
    const feedSchedule = async () => {
      for (const [tMs, payload] of stdinChunks) {
        await new Promise((r) => setTimeout(r, tMs));
        if (cancelled) break;
        try {
          child.stdin.write(payload);
          log(`stdin: wrote ${payload.length} bytes`);
        } catch (e) {
          log(`stdin: write failed: ${e.message}`);
          break;
        }
      }
      if (!keepStdinOpen) {
        try {
          child.stdin.end();
          log("stdin: closed");
        } catch (e) {
          log(`stdin: end failed: ${e.message}`);
        }
      } else {
        log("stdin: left open");
      }
    };
    feedSchedule();

    const watchdog = setTimeout(() => {
      log(`TIMEOUT after ${timeoutMs}ms — killing`);
      cancelled = true;
      try {
        child.kill();
      } catch (_) {}
    }, timeoutMs);

    child.on("exit", () => clearTimeout(watchdog));
  });
}

await runWithEnv(
  "A. --continue, prompt at 1.5s, keep stdin open 25s",
  ["--continue"],
  [[1500, "hello world\n"]],
  { timeoutMs: 25000, keepStdinOpen: true },
);

await runWithEnv(
  "B. --continue, JSON request at 1.5s, keep stdin open 25s",
  ["--continue"],
  [
    [
      1500,
      JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }],
      }) + "\n",
    ],
  ],
  { timeoutMs: 25000, keepStdinOpen: true },
);

await runWithEnv(
  "C. no --continue, prompt at 1.5s, keep stdin open 20s",
  [],
  [[1500, "hello world\n"]],
  { timeoutMs: 20000, keepStdinOpen: true },
);

console.log(`\n[probe] all probes complete.`);

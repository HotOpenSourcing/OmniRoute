#!/usr/bin/env node
/**
 * Freebuff CLI stdin/stdout probe.
 *
 * Goal: empirically determine what protocol the official Freebuff CLI speaks
 * on stdin/stdout. We don't assume — we run the binary with various
 * arguments and dump everything we see.
 *
 * Usage: node scripts/freebuff/probe-stdio.mjs
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import process from "node:process";

const binaryName = platform() === "win32" ? "freebuff.exe" : "freebuff";
const binaryPath = join(homedir(), ".config", "manicode", binaryName);

if (!existsSync(binaryPath)) {
  console.error(`[probe] binary not found: ${binaryPath}`);
  process.exit(1);
}

console.log(`[probe] binary: ${binaryPath}`);
console.log(`[probe] size:   ${existsSync(binaryPath)} bytes`);

/**
 * Spawn the binary with the given args, optionally writing input to stdin,
 * and capture stdout/stderr/exit-code.
 */
function probe(label, args, stdinPayload = null, timeoutMs = 6000) {
  return new Promise((resolve) => {
    console.log(`\n=== ${label} ===`);
    console.log(`[probe] argv: ${binaryPath} ${args.join(" ")}`);

    const child = spawn(binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdinWritten = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      console.log(`[probe] spawn error: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      console.log(`[probe] exit: code=${code} signal=${signal}`);
      if (stdout) {
        console.log(`--- stdout (${stdout.length} bytes) ---`);
        console.log(stdout);
        console.log(`--- end stdout ---`);
      } else {
        console.log(`--- stdout: (empty) ---`);
      }
      if (stderr) {
        console.log(`--- stderr (${stderr.length} bytes) ---`);
        console.log(stderr);
        console.log(`--- end stderr ---`);
      } else {
        console.log(`--- stderr: (empty) ---`);
      }
      resolve({ code, signal, stdout, stderr, stdinWritten });
    });

    if (stdinPayload !== null) {
      setTimeout(() => {
        try {
          child.stdin.write(stdinPayload);
          child.stdin.end();
          stdinWritten = true;
          console.log(`[probe] stdin: wrote ${stdinPayload.length} bytes`);
        } catch (e) {
          console.log(`[probe] stdin write failed: ${e.message}`);
        }
      }, 500);
    }

    setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill("SIGTERM");
        } catch (_) {
          /* already exited */
        }
      }
    }, timeoutMs);
  });
}

const probes = [
  // 1. --help (already known but reconfirm output format)
  { label: "1. --help", args: ["--help"], stdin: null, timeout: 4000 },
  // 2. --version
  { label: "2. --version", args: ["--version"], stdin: null, timeout: 4000 },
  // 3. bare invocation — what does it do with no input?
  { label: "3. no args, no stdin", args: [], stdin: null, timeout: 4000 },
  // 4. --continue with empty stdin
  {
    label: "4. --continue, no stdin",
    args: ["--continue"],
    stdin: null,
    timeout: 5000,
  },
  // 5. --continue then write a plain-text prompt
  {
    label: "5. --continue, plain text stdin",
    args: ["--continue"],
    stdin: "hello world\n",
    timeout: 8000,
  },
  // 6. --continue then write a JSON request
  {
    label: "6. --continue, JSON stdin",
    args: ["--continue"],
    stdin: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
    }) + "\n",
    timeout: 8000,
  },
  // 7. try `chat` subcommand (does it exist?)
  {
    label: "7. chat --help",
    args: ["chat", "--help"],
    stdin: null,
    timeout: 4000,
  },
  // 8. try `run` subcommand
  {
    label: "8. run --help",
    args: ["run", "--help"],
    stdin: null,
    timeout: 4000,
  },
  // 9. unknown flag — should print usage
  { label: "9. --bogus", args: ["--bogus"], stdin: null, timeout: 4000 },
];

for (const p of probes) {
  await probe(p.label, p.args, p.stdin, p.timeout);
}

console.log(`\n[probe] all probes complete.`);

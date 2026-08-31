#!/usr/bin/env node
/**
 * Search for WEBSITE_URL constant in the SDK
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const root = join(homedir(), ".config", "manicode", "codebuff", "sdk", "src");

const results = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (f.endsWith(".ts") || f.endsWith(".js")) {
      try {
        const c = readFileSync(p, "utf8");
        if (c.includes("WEBSITE_URL")) {
          const lines = c.split("\n");
          lines.forEach((line, i) => {
            if (line.includes("WEBSITE_URL")) {
              results.push(`${p}:${i + 1}: ${line.trim()}`);
            }
          });
        }
      } catch {}
    }
  }
}

walk(root);
console.log(results.join("\n"));

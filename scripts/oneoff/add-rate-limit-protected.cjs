#!/usr/bin/env node
/**
 * One-off script: add `rateLimitProtected: true` to every provider entry
 * except those in LOCAL_PROVIDERS (self-hosted, no remote rate limit),
 * SYSTEM_PROVIDERS (virtual `auto` provider), and the Kiro entry (already
 * has the flag). Mirrors the Kiro behavior so all real connectable
 * providers auto-enable rate-limit protection on new connections.
 *
 * Idempotent — re-running produces no further changes (entries that already
 * have `rateLimitProtected` are skipped).
 */
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(process.cwd(), "src/shared/constants/providers.ts");
let content = fs.readFileSync(FILE, "utf8");
const original = content;

const SKIP_MAPS = new Set(["LOCAL_PROVIDERS", "SYSTEM_PROVIDERS"]);
const SKIP_IDS = new Set(["kiro"]); // already has the flag

let currentMap = null;
let result = "";
let i = 0;
const len = content.length;
let entryCount = 0;
let modifiedCount = 0;
let skippedMapCount = 0;
let skippedIdCount = 0;
let alreadyHasFlagCount = 0;
const modifiedIds = [];
const skippedMapIds = [];
const skippedIdIds = [];

while (i < len) {
  // Detect map start: "export const XXX_PROVIDERS = {"
  const mapStartMatch = content.slice(i).match(/^export const (\w+_PROVIDERS)\s*=\s*\{/);
  if (mapStartMatch) {
    currentMap = mapStartMatch[1];
    result += mapStartMatch[0];
    i += mapStartMatch[0].length;
    continue;
  }

  // Detect map end: "};"
  if (currentMap && content.slice(i).match(/^\};/)) {
    currentMap = null;
    result += content[i];
    i++;
    continue;
  }

  // Detect entry start (only in non-skipped maps)
  if (currentMap && !SKIP_MAPS.has(currentMap)) {
    const slice = content.slice(i);
    // Match "  <key>: {" or "  "<key>": {" — both quoted and unquoted keys.
    // File uses CRLF line endings, so match \r?\n.
    const entryMatch = slice.match(/^  (?:"([^"]+)"|([\w-]+)):\s*\{\r?\n/);
    if (entryMatch) {
      const entryStart = i;
      const entryHeaderLen = entryMatch[0].length;
      // Find matching closing brace (string-aware)
      let depth = 1;
      let j = entryStart + entryHeaderLen;
      let inString = false;
      let stringChar = null;
      let prevCh = "";
      while (j < len && depth > 0) {
        const ch = content[j];
        if (inString) {
          if (ch === stringChar && prevCh !== "\\") {
            inString = false;
            stringChar = null;
          }
        } else {
          if (ch === '"' || ch === "'" || ch === "`") {
            inString = true;
            stringChar = ch;
          } else if (ch === "{") {
            depth++;
          } else if (ch === "}") {
            depth--;
          }
        }
        prevCh = ch;
        j++;
      }
      // j is just past the closing `}`
      let entryEnd = j;
      if (content[entryEnd] === ",") entryEnd++;
      if (content[entryEnd] === "\n") entryEnd++;

      const entry = content.slice(entryStart, entryEnd);

      const idMatch = entry.match(/\r?\n\s+id:\s*"([^"]+)"/);
      const id = idMatch ? idMatch[1] : null;

      entryCount++;

      if (!id) {
        // Entry without an id — leave alone
        result += entry;
        i = entryEnd;
        continue;
      }

      if (SKIP_IDS.has(id)) {
        skippedIdCount++;
        skippedIdIds.push(id);
        result += entry;
        i = entryEnd;
        continue;
      }

      if (entry.includes("rateLimitProtected")) {
        alreadyHasFlagCount++;
        result += entry;
        i = entryEnd;
        continue;
      }

      // Insert rateLimitProtected before the closing `},` or `}`
      const closingPattern = /\r?\n(  \},?)$/;
      const closingMatch = entry.match(closingPattern);
      if (closingMatch) {
        const insertAt = closingMatch.index;
        // Detect whether the file uses CRLF here
        const isCrlf = entry.includes("\r");
        const lineBreak = isCrlf ? "\r\n" : "\n";
        const newEntry =
          entry.slice(0, insertAt) +
          lineBreak + "    rateLimitProtected: true," +
          entry.slice(insertAt);
        result += newEntry;
        modifiedCount++;
        modifiedIds.push(id);
      } else {
        result += entry;
      }
      i = entryEnd;
      continue;
    }
  } else if (currentMap && SKIP_MAPS.has(currentMap)) {
    // Count entries in skipped maps for the report
    const slice = content.slice(i);
    // Match "  <key>: {" or "  "<key>": {" — both quoted and unquoted keys.
    // File uses CRLF line endings, so match \r?\n.
    const entryMatch = slice.match(/^  (?:"([^"]+)"|([\w-]+)):\s*\{\r?\n/);
    if (entryMatch) {
      const entryStart = i;
      const entryHeaderLen = entryMatch[0].length;
      let depth = 1;
      let j = entryStart + entryHeaderLen;
      let inString = false;
      let stringChar = null;
      let prevCh = "";
      while (j < len && depth > 0) {
        const ch = content[j];
        if (inString) {
          if (ch === stringChar && prevCh !== "\\") {
            inString = false;
            stringChar = null;
          }
        } else {
          if (ch === '"' || ch === "'" || ch === "`") {
            inString = true;
            stringChar = ch;
          } else if (ch === "{") {
            depth++;
          } else if (ch === "}") {
            depth--;
          }
        }
        prevCh = ch;
        j++;
      }
      let entryEnd = j;
      if (content[entryEnd] === ",") entryEnd++;
      if (content[entryEnd] === "\n") entryEnd++;

      const entry = content.slice(entryStart, entryEnd);
      const idMatch = entry.match(/\n\s+id:\s*"([^"]+)"/);
      const id = idMatch ? idMatch[1] : null;
      if (id) {
        skippedMapCount++;
        skippedMapIds.push(id);
      }
      result += entry;
      i = entryEnd;
      continue;
    }
  }

  result += content[i];
  i++;
}

if (result !== original) {
  fs.writeFileSync(FILE, result);
  console.log("=== providers.ts rateLimitProtected sweep ===");
  console.log(`Total entries processed: ${entryCount}`);
  console.log(`Modified (rateLimitProtected added): ${modifiedCount}`);
  console.log(`Skipped (in LOCAL/SYSTEM map): ${skippedMapCount} -> ${skippedMapIds.join(", ")}`);
  console.log(`Skipped (kiro, already has flag): ${skippedIdCount}`);
  console.log(`Already had rateLimitProtected: ${alreadyHasFlagCount}`);
  console.log(`\nModified IDs (${modifiedCount}): ${modifiedIds.join(", ")}`);
} else {
  console.log("No changes made.");
}

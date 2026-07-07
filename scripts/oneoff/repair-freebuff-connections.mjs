#!/usr/bin/env node
/**
 * One-shot repair script for freebuff connections persisted before the
 * v3.8.43 `parseFreebuffPastedCredentials` Shape-2 fix.
 *
 * Background: in v3.8.40 and earlier, an import-token call with the legacy
 * Freebuff CLI `credentials.json` (which has a `default.authToken` wrapper)
 * would persist the entire JSON blob as the connection's `accessToken`. The
 * default OpenAI executor then re-serialized that blob into
 * `Authorization: Bearer <json>`, which Node's `Headers.append` rejected
 * with "is an invalid header value" (HTTP 502 to the caller).
 *
 * This script reads every `provider = 'freebuff'` row in `storage.sqlite`,
 * runs the accessToken through `sanitizeFreebuffAccessToken`, and (with
 * `--apply`) writes the repair back. Run it ONCE after pulling the
 * v3.8.43+ code; it is a no-op for clean connections.
 *
 * Usage (Windows PowerShell, from the project root):
 *
 *   # Dry-run (read-only) — shows what would be repaired:
 *   node scripts/oneoff/repair-freebuff-connections.mjs
 *
 *   # Apply repairs (auto-backs up the DB first):
 *   node scripts/oneoff/repair-freebuff-connections.mjs --apply
 *
 *   # Custom DB path (overrides auto-detection):
 *   node scripts/oneoff/repair-freebuff-connections.mjs --apply --db "C:\path\to\storage.sqlite"
 *
 * Exit codes:
 *   0 — nothing to repair, or all repairs applied successfully
 *   1 — could not locate the DB
 *   2 — repair attempted but a row failed (other rows may still be repaired)
 */

import Database from "better-sqlite3";
import { existsSync, copyFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const dbArg = (() => {
  const idx = process.argv.indexOf("--db");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

// ─── Locate the SQLite DB ──────────────────────────────────────────────────
function readDataDirFromEnv(envPath) {
  if (!existsSync(envPath)) return null;
  try {
    const raw = readFileSync(envPath, "utf8");
    const m = raw.match(/^\s*DATA_DIR\s*=\s*(.+?)\s*$/m);
    return m?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function defaultDbCandidates() {
  const candidates = [];
  // 1. DATA_DIR from .env (highest priority).
  const envDataDir = readDataDirFromEnv(resolve(process.cwd(), ".env"));
  if (envDataDir) candidates.push(join(envDataDir, "storage.sqlite"));
  // 2. WSL/Linux default.
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    candidates.push(join(home, ".omniroute", "storage.sqlite"));
    candidates.push(join(home, ".config", "omniroute", "storage.sqlite"));
  }
  // 3. Windows defaults.
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, "OmniRoute", "storage.sqlite"));
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "OmniRoute", "storage.sqlite"));
  return candidates;
}

const DB_PATH =
  dbArg ||
  defaultDbCandidates().find((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });

if (!DB_PATH) {
  console.error("ERROR: could not locate storage.sqlite.");
  console.error("Tried:");
  for (const p of defaultDbCandidates()) console.error("  -", p);
  console.error("Pass --db <path> to override.");
  process.exit(1);
}

console.log(`DB: ${DB_PATH}`);
console.log(`Mode: ${APPLY ? "APPLY (will write)" : "DRY-RUN (read-only)"}`);
console.log("");

// ─── Load the helpers from src/ via the project's tsx loader ───────────────
// (We re-implement sanitize inline below so this script is self-contained
// and does not require a TypeScript build step. The logic is the same as
// src/lib/oauth/providers/freebuff.ts::sanitizeFreebuffAccessToken — keep
// them in sync if the canonical helper changes.)

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const FP_ID_RE = /^enhanced-[A-Za-z0-9_-]{43}$/;
const FP_HASH_RE = /^[a-f0-9]{64}$/;
const isUuid = (s) => typeof s === "string" && UUID_RE.test(s);

function sanitizeFreebuffAccessToken(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("{") && isUuid(raw)) return null;
  if (!raw.startsWith("{")) return null;
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const def = obj.default;
  if (!def || typeof def !== "object") return null;
  const real = def.authToken;
  if (!isUuid(real)) return null;
  const repair = { authToken: real };
  if (isUuid(def.id)) repair.userId = def.id;
  if (typeof def.email === "string" && def.email) repair.email = def.email;
  if (typeof def.fingerprintId === "string" && FP_ID_RE.test(def.fingerprintId)) {
    repair.fingerprintId = def.fingerprintId;
  }
  if (typeof def.fingerprintHash === "string" && FP_HASH_RE.test(def.fingerprintHash)) {
    repair.fingerprintHash = def.fingerprintHash;
  }
  return repair;
}

function repairRow(row) {
  const repair = sanitizeFreebuffAccessToken(row.access_token);
  if (!repair) return null;
  const updates = { access_token: repair.authToken };
  let psd = {};
  if (row.provider_specific_data) {
    try {
      psd = JSON.parse(row.provider_specific_data);
      if (!psd || typeof psd !== "object") psd = {};
    } catch {
      psd = {};
    }
  }
  if (repair.fingerprintId) psd.fingerprintId = repair.fingerprintId;
  if (repair.fingerprintHash) psd.fingerprintHash = repair.fingerprintHash;
  if (repair.userId) psd.userId = repair.userId;
  if (repair.email) psd.userEmail = repair.email;
  if (Object.keys(psd).length > 0) updates.provider_specific_data = JSON.stringify(psd);
  return updates;
}

function maskUuid(s) {
  if (!s || s.length < 8) return "(short)";
  return s.slice(0, 4) + "…" + "x".repeat(Math.max(0, s.length - 8)) + s.slice(-4);
}

// ─── Step 1: dry-run scan (read-only) ──────────────────────────────────────
const db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });
db.pragma("journal_mode = WAL");

const cols = db.prepare("PRAGMA table_info(provider_connections)").all();
const colNames = new Set(cols.map((c) => c.name));
if (!colNames.has("access_token") || !colNames.has("provider_specific_data")) {
  console.error("ERROR: provider_connections table is missing expected columns.");
  console.error("Found columns:", [...colNames].join(", "));
  process.exit(1);
}

const rows = db
  .prepare(
    `SELECT id, email, access_token, provider_specific_data
     FROM provider_connections
     WHERE provider = ?`,
  )
  .all("freebuff");

console.log(`Found ${rows.length} freebuff connection(s)\n`);

const repairs = [];
for (const r of rows) {
  const psd = (() => {
    if (!r.provider_specific_data) return {};
    try {
      return JSON.parse(r.provider_specific_data) || {};
    } catch {
      return {};
    }
  })();
  const repair = repairRow(r);
  console.log(`--- ${r.id} ---`);
  console.log(`  email:                ${r.email || "(none)"}`);
  console.log(`  access_token.length:  ${r.access_token ? r.access_token.length : 0}`);
  console.log(
    `  access_token.isJSON:  ${typeof r.access_token === "string" && r.access_token.startsWith("{")}`,
  );
  console.log(`  psd keys:             ${Object.keys(psd).join(", ") || "(none)"}`);
  if (repair) {
    repairs.push({ row: r, repair });
    console.log(`  REPAIR:`);
    console.log(`    new authToken:    ${maskUuid(repair.access_token)} (length ${repair.access_token.length})`);
    if (repair.provider_specific_data) {
      const parsed = JSON.parse(repair.provider_specific_data);
      if (parsed.userId) console.log(`    userId:           ${parsed.userId}`);
      if (parsed.userEmail) console.log(`    userEmail:        ${parsed.userEmail}`);
      if (parsed.fingerprintId) console.log(`    fingerprintId:    ${parsed.fingerprintId.slice(0, 20)}…`);
      if (parsed.fingerprintHash) console.log(`    fingerprintHash:  ${parsed.fingerprintHash.slice(0, 8)}…${parsed.fingerprintHash.slice(-4)}`);
    }
  } else {
    console.log(`  ALREADY CLEAN (no repair needed)`);
  }
  console.log("");
}

if (repairs.length === 0) {
  console.log("No repairs needed — done.");
  db.close();
  process.exit(0);
}

if (!APPLY) {
  console.log(`${repairs.length} repair(s) available. Re-run with --apply to write them.`);
  db.close();
  process.exit(0);
}

// ─── Step 2: apply repairs (auto-backup first) ────────────────────────────
const backupPath = join(
  dirname(DB_PATH),
  `storage.sqlite.repair-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
console.log(`Backing up DB to: ${backupPath}`);
copyFileSync(DB_PATH, backupPath);

// Re-open in read-write mode (the readonly connection above cannot write).
db.close();
const wdb = new Database(DB_PATH, { fileMustExist: true });
wdb.pragma("journal_mode = WAL");

const updateStmt = wdb.prepare(
  `UPDATE provider_connections
   SET access_token = @access_token,
       provider_specific_data = @provider_specific_data,
       updated_at = ?
   WHERE id = ?`,
);

let ok = 0;
let failed = 0;
const txn = wdb.transaction((items) => {
  const now = new Date().toISOString();
  for (const { row, repair } of items) {
    try {
      updateStmt.run({
        access_token: repair.access_token,
        provider_specific_data: repair.provider_specific_data || row.provider_specific_data || null,
        id: row.id,
      });
      // updated_at goes last in positional arg list (named params don't bind
      // in the same @ slot when re-used with different types — SQLite is
      // happy with positional here).
      // Re-run with positional to set updated_at:
      wdb.prepare(`UPDATE provider_connections SET updated_at = ? WHERE id = ?`).run(now, row.id);
      console.log(`  ✓ ${row.id} repaired`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${row.id} failed:`, err.message);
      failed++;
    }
  }
});

txn(repairs);
wdb.close();

// ─── Step 3: verify ────────────────────────────────────────────────────────
const vdb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
console.log("\nVerification:");
for (const { row } of repairs) {
  const after = vdb
    .prepare("SELECT access_token, provider_specific_data FROM provider_connections WHERE id = ?")
    .get(row.id);
  const cleaned =
    typeof after.access_token === "string" &&
    after.access_token.length === 36 &&
    isUuid(after.access_token);
  console.log(`  ${cleaned ? "✓" : "✗"} ${row.id}: access_token is now ${maskUuid(after.access_token)}`);
}
vdb.close();

console.log(`\nDone. ${ok} repaired, ${failed} failed. Backup at: ${backupPath}`);
process.exit(failed === 0 ? 0 : 2);

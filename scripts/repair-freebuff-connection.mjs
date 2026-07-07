/**
 * One-shot repair script for Freebuff connections whose `accessToken`
 * was stored as the full credentials.json blob (v3.8.40 and earlier bug).
 *
 * Usage:
 *   node --import tsx/esm scripts/repair-freebuff-connection.mjs
 */

import Database from "better-sqlite3";
import { repairFreebuffConnectionRow } from "../src/lib/oauth/providers/freebuff.ts";

const DB_PATH =
  process.env.OMNIROUTE_DB ||
  `${process.env.APPDATA || process.env.HOME}\\omniroute\\storage.sqlite`;

console.log(`[repair-freebuff] DB: ${DB_PATH}`);

const db = new Database(DB_PATH, { readonly: false });

const rows = db
  .prepare(
    `SELECT id, provider, email, access_token, provider_specific_data, test_status, is_active
     FROM provider_connections
     WHERE provider = 'freebuff'`
  )
  .all();

console.log(`[repair-freebuff] Found ${rows.length} freebuff connection(s)`);

let repaired = 0;
let alreadyClean = 0;

for (const row of rows) {
  const psd = row.provider_specific_data
    ? JSON.parse(row.provider_specific_data)
    : null;

  const preview = String(row.access_token || "").slice(0, 60);
  console.log(`\n--- ${row.id} ---`);
  console.log(`  email: ${row.email || "(empty)"}`);
  console.log(`  testStatus: ${row.test_status}`);
  console.log(`  isActive: ${row.is_active}`);
  console.log(`  accessToken preview: ${preview}${preview.length >= 60 ? "..." : ""}`);

  const repair = repairFreebuffConnectionRow({
    accessToken: row.access_token,
    providerSpecificData: psd,
  });

  if (!repair) {
    console.log(`  → ALREADY CLEAN`);
    alreadyClean++;
    continue;
  }

  console.log(`  → REPAIRING:`);
  console.log(`     new accessToken: ${repair.accessToken}`);
  console.log(
    `     fingerprintId: ${repair.providerSpecificData?.fingerprintId || "(none)"}`
  );
  console.log(
    `     fingerprintHash: ${repair.providerSpecificData?.fingerprintHash || "(none)"}`
  );

  const merged = { ...(psd || {}), ...(repair.providerSpecificData || {}) };

  db.prepare(
    `UPDATE provider_connections
     SET access_token = ?,
         provider_specific_data = ?,
         test_status = 'active',
         is_active = 1
     WHERE id = ?`
  ).run(repair.accessToken, JSON.stringify(merged), row.id);

  repaired++;
}

console.log(`\n[repair-freebuff] Summary: ${repaired} repaired, ${alreadyClean} already clean`);

db.close();

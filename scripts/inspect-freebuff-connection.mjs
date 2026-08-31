import Database from "better-sqlite3";

const DB_PATH = `${process.env.APPDATA}\\omniroute\\storage.sqlite`;
console.log(`[inspect] DB: ${DB_PATH}`);

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const rows = db
  .prepare(
    `SELECT id, provider, email, access_token, provider_specific_data, test_status, is_active
     FROM provider_connections
     WHERE provider = 'freebuff'`
  )
  .all();

console.log(`[inspect] Found ${rows.length} freebuff connection(s)\n`);

for (const row of rows) {
  const psd = row.provider_specific_data
    ? JSON.parse(row.provider_specific_data)
    : null;
  const at = String(row.access_token || "");
  console.log(`--- ${row.id} ---`);
  console.log(`  email: ${row.email || "(empty)"}`);
  console.log(`  testStatus: ${row.test_status}`);
  console.log(`  isActive: ${row.is_active}`);
  console.log(`  accessToken length: ${at.length}`);
  console.log(`  accessToken preview: ${at.slice(0, 80)}${at.length > 80 ? "..." : ""}`);
  console.log(`  providerSpecificData:`, JSON.stringify(psd, null, 2));
  console.log();
}

db.close();

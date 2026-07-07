import Database from "better-sqlite3";

const DB_PATH = `${process.env.APPDATA}\\omniroute\\storage.sqlite`;
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const cols = db.prepare(`PRAGMA table_info(provider_connections)`).all();
console.log("provider_connections columns:");
for (const c of cols) console.log(`  ${c.name} (${c.type})`);

console.log("\n--- Freebuff row (full) ---");
const rows = db
  .prepare(
    `SELECT * FROM provider_connections WHERE provider = 'freebuff'`
  )
  .all();

for (const r of rows) {
  for (const [k, v] of Object.entries(r)) {
    let display = v;
    if (typeof v === "string" && v.length > 100) display = v.slice(0, 100) + "...";
    console.log(`  ${k}: ${JSON.stringify(display)}`);
  }
}

db.close();

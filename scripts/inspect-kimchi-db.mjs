import Database from "better-sqlite3";
import path from "path";
import os from "os";

const dbPath = path.join(os.homedir(), "AppData", "Roaming", "omniroute", "storage.sqlite");
console.log("DB path:", dbPath);
const db = new Database(dbPath);

// Find all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log("\nAll tables:", tables.map(t => t.name).join(", "));

// Look for connection-related tables
const connTables = tables.filter(t =>
  t.name.includes("provider") || t.name.includes("connection") || t.name.includes("account")
);
console.log("\nConnection-related tables:", connTables.map(t => t.name));

// Inspect schema of each relevant table
for (const t of connTables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n--- ${t.name} columns:`, cols.map(c => c.name).join(", "));
  const rows = db.prepare(`SELECT * FROM ${t.name} WHERE provider = 'kimchi'`).all();
  if (rows.length > 0) {
    console.log(`  Kimchi rows:`, JSON.stringify(rows, null, 2));
  }
}

db.close();

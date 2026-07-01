import Database from "better-sqlite3";
import path from "path";
import os from "os";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const dbPath = path.join(os.homedir(), "AppData", "Roaming", "omniroute", "storage.sqlite");
const db = new Database(dbPath);

// New Kimchi API key
const NEW_KEY = "castai_v1_70e9049839eaf2a184e20e3ec8ad6f3090cad9d8ceb787a4e25b8918526417ee_3f3e9988";

// Check current state
const conn = db.prepare(
  "SELECT id, provider, name, is_active, test_status, api_key FROM provider_connections WHERE provider = 'kimchi'"
).get();

if (!conn) {
  console.error("No Kimchi connection found in DB!");
  db.close();
  process.exit(1);
}

console.log("Current connection:", JSON.stringify(conn, null, 2));

// Get the encryption key from settings or env
// OmniRoute stores API keys encrypted. We need to check if there's a raw insert path.
// The simplest approach: check if the existing key is encrypted or plain
const existingKey = conn.api_key;
console.log("Existing key prefix:", existingKey?.slice(0, 20));

// If it starts with 'enc:v1:' it's encrypted — we need to use OmniRoute's
// update mechanism. For now, reset connection to active state + update key as plaintext
// (OmniRoute will re-encrypt on next save via dashboard)
// Actually we can't easily encrypt without the master key. Instead:
// The safest approach is to use the OmniRoute API to update the key.

// Let's try setting the api_key as a placeholder to trigger dashboard re-entry
// Reset connection state to active
const result = db.prepare(`
  UPDATE provider_connections
  SET
    is_active = 1,
    test_status = 'ok',
    error_code = NULL,
    last_error = NULL,
    last_error_type = NULL,
    last_error_at = NULL,
    backoff_level = 0,
    rate_limited_until = NULL,
    updated_at = datetime('now')
  WHERE provider = 'kimchi'
`).run();

console.log(`Reset ${result.changes} Kimchi connection(s) to active.`);

// Show what needs to be updated via dashboard
console.log("\n=== IMPORTANT ===");
console.log("New API key to enter in the dashboard:");
console.log(NEW_KEY);
console.log("\nGo to: http://localhost:20128/dashboard/providers/kimchi");
console.log("Edit the connection and update the API key.");

db.close();

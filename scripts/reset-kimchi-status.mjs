import Database from "better-sqlite3";
import path from "path";
import os from "os";

const dbPath = path.join(os.homedir(), "AppData", "Roaming", "omniroute", "storage.sqlite");
const db = new Database(dbPath);

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
    rate_limited_until = NULL
  WHERE provider = 'kimchi'
`).run();

console.log(`Reset ${result.changes} Kimchi connection(s).`);

const after = db.prepare(
  "SELECT id, provider, name, is_active, test_status, error_code, last_error_type FROM provider_connections WHERE provider = 'kimchi'"
).all();
console.log("After:", JSON.stringify(after, null, 2));

db.close();

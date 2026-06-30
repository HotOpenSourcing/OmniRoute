import Database from "better-sqlite3";
import path from "path";
import os from "os";

const dbPath = path.join(os.homedir(), "AppData", "Roaming", "omniroute", "storage.sqlite");
const db = new Database(dbPath);

// Reset Kimchi connections
const resKimchi = db.prepare(`
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
console.log(`Reset ${resKimchi.changes} Kimchi connection(s) to active.`);

// Insert or update settings to disable autoDisableBannedAccounts
const setExist = db.prepare("SELECT * FROM key_value WHERE namespace = 'settings' AND key = 'autoDisableBannedAccounts'").get();
if (setExist) {
  db.prepare("UPDATE key_value SET value = 'false' WHERE namespace = 'settings' AND key = 'autoDisableBannedAccounts'").run();
  console.log("Updated autoDisableBannedAccounts to false in settings.");
} else {
  db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('settings', 'autoDisableBannedAccounts', 'false')").run();
  console.log("Inserted autoDisableBannedAccounts = false into settings.");
}

db.close();
console.log("DB update complete.");

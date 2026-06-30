import Database from "better-sqlite3";
import path from "path";
import os from "os";

const dbPath = path.join(os.homedir(), "AppData", "Roaming", "omniroute", "storage.sqlite");
const db = new Database(dbPath);

const settings = db.prepare("SELECT * FROM key_value").all();
console.log("Settings rows:", JSON.stringify(settings, null, 2));

db.close();

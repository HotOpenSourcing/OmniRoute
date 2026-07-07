import Database from "better-sqlite3";
const db = new Database("C:/Users/amine/AppData/Roaming/omniroute/storage.sqlite", { readonly: true });
const apiKeys = db.prepare("SELECT id, name, key, scopes FROM api_keys ORDER BY created_at DESC").all();
for (const k of apiKeys) console.log(`${k.id} | ${k.name} | ${k.key} | ${k.scopes}`);

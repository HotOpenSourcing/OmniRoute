import Database from "better-sqlite3";
const db = new Database("C:/Users/amine/AppData/Roaming/omniroute/storage.sqlite", { readonly: true });

const settings = db.prepare("SELECT key, substr(value,1,400) as v FROM key_value WHERE key IN ('password','requireLogin','setupComplete','jwtSecret','INITIAL_PASSWORD') OR key LIKE '%password%' OR key LIKE '%auth%'").all();
console.log("SETTINGS:");
for (const s of settings) console.log(`  ${s.key} = ${s.v}`);

const apiKeys = db.prepare("SELECT id, name, substr(key,1,20) as k, scopes FROM api_keys LIMIT 10").all();
console.log("\nAPI KEYS:");
for (const k of apiKeys) console.log(`  ${k.id} | ${k.name} | ${k.k}... | ${k.scopes}`);

const conns = db.prepare("SELECT id, provider, email, auth_type, substr(access_token,1,40) as tok, substr(provider_specific_data,1,200) as psd FROM provider_connections WHERE provider='freebuff'").all();
console.log("\nFREEBUFF CONNECTIONS:");
for (const c of conns) console.log(`  ${c.id} | ${c.email} | ${c.auth_type} | ${c.tok}... | ${c.psd}`);

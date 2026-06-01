import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { pathToFileURL } from 'url';

function makeTempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function importFresh(modulePath){ const url = pathToFileURL(path.resolve(modulePath)).href; return import(`${url}?debug=${Date.now()}`); }

function createRecoverableDb(sqliteFile){
  const seedDb = new Database(sqliteFile);
  const now = new Date().toISOString();
  seedDb.exec(`
    CREATE TABLE provider_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, auth_type TEXT, name TEXT, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE provider_nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, prefix TEXT, api_type TEXT, base_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE key_value (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (namespace, key));
    CREATE TABLE combos (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, data TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, machine_id TEXT, allowed_models TEXT DEFAULT '[]', no_log INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  `);
  seedDb.prepare("INSERT INTO provider_connections (id, provider, auth_type, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run('recover-openai','openai','apikey','Recover Me',1,now,now);
  seedDb.prepare("INSERT INTO provider_nodes (id,type,name,prefix,api_type,base_url,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run('recover-node','custom','Recover Node','recover','openai','https://example.com',now,now);
  seedDb.prepare("INSERT INTO key_value (namespace,key,value) VALUES (?, ?, ?)").run('settings','globalFallbackModel', JSON.stringify('openai/gpt-4o-mini'));
  seedDb.prepare("INSERT INTO combos (id,name,data,sort_order,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run('recover-combo','Recover Combo', JSON.stringify({ id:'recover-combo', name:'Recover Combo', models: ['openai/gpt-4o-mini']}),1,now,now);
  seedDb.prepare("INSERT INTO api_keys (id,name,key,machine_id,allowed_models,no_log,created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run('recover-key','Recover Key','sk-recover-key','machine-recover',JSON.stringify(['openai/gpt-4o-mini']),1,now);
  seedDb.close();
}

async function run(){
  const dataDir = makeTempDir('omniroute-db-probe-recover-');
  const sqliteFile = path.join(dataDir, 'storage.sqlite');
  createRecoverableDb(sqliteFile);

  const originalPrepare = Database.prototype.prepare;
  Database.prototype.prepare = function patchedPrepare(sql, ...args){ if(String(sql).includes('schema_migrations')) throw new Error('forced probe failure'); return originalPrepare.call(this, sql, ...args); };

  process.env.DATA_DIR = dataDir;

  try{
    const core = await importFresh('src/lib/db/core.ts');
    console.log('Calling captureCriticalDbStateForTesting on original file...');
    const snapshotBefore = core.captureCriticalDbStateForTesting(sqliteFile);
    console.log('snapshotBefore:', JSON.stringify(snapshotBefore, null, 2));

    try{
      console.log('Calling getDbInstance...');
      const db = core.getDbInstance();
      console.log('getDbInstance succeeded; provider row:', db.prepare('SELECT id FROM provider_connections WHERE id = ?').get('recover-openai'));
    } catch (err){
      console.error('getDbInstance thrown:', err);
    }

    const backups = fs.readdirSync(dataDir).filter(n=>n.includes('.probe-failed-'));
    console.log('backups in dataDir:', backups);
    for(const b of backups){
      const p = path.join(dataDir, b);
      const snap = core.captureCriticalDbStateForTesting(p);
      console.log('snapshot for backup', b, JSON.stringify(snap, null, 2));
    }
  } finally{
    Database.prototype.prepare = originalPrepare;
  }
}

run().catch(e=>{ console.error('fatal', e); process.exit(1); });

/**
 * Update Kimchi API key in OmniRoute DB using the proper encryption module.
 * Run: node --import tsx/esm scripts/set-kimchi-key.ts
 */
import { updateProviderConnection } from "../src/lib/db/providers.js";
import { getDbInstance } from "../src/lib/db/core.js";

const NEW_KEY = "castai_v1_70e9049839eaf2a184e20e3ec8ad6f3090cad9d8ceb787a4e25b8918526417ee_3f3e9988";
const KIMCHI_CONN_ID = "9e228b7e-6ada-4b1b-8dad-72c0defb5a4f";

async function main() {
  // updateProviderConnection handles encryption automatically
  await updateProviderConnection(KIMCHI_CONN_ID, {
    apiKey: NEW_KEY,
    isActive: true,
    testStatus: "ok",
    errorCode: null,
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    backoffLevel: 0,
    rateLimitedUntil: null,
  });

  // Verify
  const db = getDbInstance();
  const row = db.prepare(
    "SELECT id, provider, name, is_active, test_status, api_key FROM provider_connections WHERE id = ?"
  ).get(KIMCHI_CONN_ID);
  console.log("Updated connection:", JSON.stringify(row, null, 2));
  console.log("\n✅ New Kimchi API key set and connection activated.");
}

main().catch((e) => { console.error(e); process.exit(1); });

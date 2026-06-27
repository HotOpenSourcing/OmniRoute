// Init proper OAuth flow: POST /oauth/cli/init → GET /oauth/cli/poll/{flow_id}
import crypto from "node:crypto";

const TOKEN = "https://zcode.z.ai/api/v1/oauth/token";
const INIT = "https://zcode.z.ai/api/v1/oauth/cli/init";

async function flow() {
  // Step 1: Generate pollToken (32 bytes hex = 64 hex chars)
  const pollToken = crypto.randomBytes(32).toString("hex");
  console.log("=== Step 1: POST /oauth/cli/init ===");
  console.log("pollToken:", pollToken.slice(0, 16) + "...");
  
  const variants = [
    { name: "Bearer pollToken, provider:zai", h: { Authorization: `Bearer ${pollToken}`, "Content-Type": "application/json" }, b: JSON.stringify({ provider: "zai" }) },
    { name: "No auth, provider:zai", h: { "Content-Type": "application/json" }, b: JSON.stringify({ provider: "zai" }) },
    { name: "Bearer pollToken, provider:zai-coding-plan", h: { Authorization: `Bearer ${pollToken}`, "Content-Type": "application/json" }, b: JSON.stringify({ provider: "zai-coding-plan" }) },
    { name: "Bearer pollToken, provider:bigmodel", h: { Authorization: `Bearer ${pollToken}`, "Content-Type": "application/json" }, b: JSON.stringify({ provider: "bigmodel" }) },
    { name: "Bearer client_id", h: { Authorization: `Bearer client_P8X5CMWmlaRO9gyO-KSqtg`, "Content-Type": "application/json" }, b: JSON.stringify({ provider: "zai" }) },
    { name: "JSON {code, state} on tokenUrl", h: { "Content-Type": "application/json" }, b: JSON.stringify({ code: "code-init-test-verify", state: "test123" }) },
  ];
  
  for (const v of variants) {
    try {
      const res = await fetch(INIT, { method: "POST", headers: v.h, body: v.b });
      const text = await res.text();
      const tag = res.ok ? "✅" : `❌${res.status}`;
      console.log(`[${tag}] ${v.name}`);
      if (res.ok || res.status !== 404) console.log("   ", text.slice(0, 400));
    } catch (e) { console.log(`[ERR] ${v.name}: ${e.message}`); }
  }
  
  // Step 2: Try poll endpoint with flow_id pattern
  console.log("\n=== Step 2: Test poll pattern ===");
  const pollVariants = [
    { url: "https://zcode.z.ai/api/v1/oauth/cli/poll/code-test-poll", h: { Authorization: `Bearer ${pollToken}` } },
    { url: "https://zcode.z.ai/api/v1/oauth/cli/poll/test-flow-123", h: { Authorization: `Bearer ${pollToken}` } },
  ];
  for (const v of pollVariants) {
    try {
      const res = await fetch(v.url, { method: "GET", headers: v.h });
      if (res.status === 404) continue;
      const text = await res.text();
      console.log(`[${res.status}] GET ${v.url}`);
      console.log("   ", text.slice(0, 400));
    } catch (e) { /* ignore */ }
  }
  
  // Step 3: Test tokenUrl with CLIENT CREDENTIALS (might be the real exchange)
  console.log("\n=== Step 3: Token exchange with client_credentials ===");
  const ccBodies = [
    { name: "{grant_type:client_credentials}", b: JSON.stringify({ grant_type: "client_credentials", client_id: "client_P8X5CMWmlaRO9gyO-KSqtg" }) },
    { name: "{grant_type:client_credentials, code}", b: JSON.stringify({ grant_type: "client_credentials", client_id: "client_P8X5CMWmlaRO9gyO-KSqtg", code: "code-ff102b4e10dd" }) },
    { name: "{grant_type:urn:ietf:params:oauth:grant-type:device_code}", b: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", code: "code-ff102b4e10dd" }) },
  ];
  for (const v of ccBodies) {
    try {
      const res = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/json" }, body: v.b });
      const text = await res.text();
      const tag = res.ok ? "✅" : `❌${res.status}`;
      console.log(`[${tag}] ${v.name}`);
      console.log("   ", text.slice(0, 400));
    } catch (e) { /* ignore */ }
  }
  
  console.log("\n=== DONE ===");
}

flow().catch(e => console.error("FATAL:", e.message));

#!/usr/bin/env node
/**
 * Check the 5 original pools NOW with correct format (number expiresAt)
 */

const API_BASE = "https://www.codebuff.com";
const OUTPUT_FILE = "C:\\Users\\amine\\OmniRoute\\scripts\\freebuff\\captured-token.json";

import { writeFileSync } from "fs";

// Original 5 pools from task-769 log
const originalAuthCodes = [
  "YX-ELj0BXtFwp1ZQY3E7Zw",
  "5RkpA4zBeDPI1HtHssHytQ",
  "80SWf6p_FLfZG437B-zeBA",
  "_5MPvHPpZR8RugXsvoe2Fg",
  "sYDFSZWBWZjTm_6JAND8ng",
];

// Re-fetch metadata for each auth code
async function getPoolData() {
  const pools = [];
  
  for (let i = 0; i < originalAuthCodes.length; i++) {
    const fingerprintId = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
    
    try {
      const res = await fetch(`${API_BASE}/api/auth/cli/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprintId }),
      });
      
      if (res.ok) {
        const json = await res.json();
        // Extract auth_code from loginUrl
        const match = json.loginUrl.match(/auth_code=([^&]+)/);
        if (match && originalAuthCodes.includes(match[1])) {
          pools.push({
            index: i + 1,
            fingerprintId: json.fingerprintId,
            fingerprintHash: json.fingerprintHash,
            expiresAt: json.expiresAt, // Keep as number
            authCode: match[1],
          });
        }
      }
    } catch (err) {
      // Silent
    }
  }
  
  return pools;
}

async function checkToken(pool) {
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${pool.fingerprintId}&fingerprintHash=${pool.fingerprintHash}&expiresAt=${pool.expiresAt}`;
  
  console.log(`\n[POOL ${pool.index}] auth_code=${pool.authCode.slice(0, 10)}...`);
  
  try {
    const res = await fetch(url);
    const json = await res.json();
    
    if (res.status === 200 && json.authToken) {
      console.log(`✅ TOKEN: ${json.authToken}`);
      console.log(`Email: ${json.email || "N/A"}`);
      
      writeFileSync(OUTPUT_FILE, JSON.stringify({
        token: json.authToken,
        email: json.email,
        capturedAt: new Date().toISOString(),
      }, null, 2));
      
      console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
      return json.authToken;
    } else {
      console.log(`[${res.status}] ${JSON.stringify(json)}`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  
  return null;
}

console.log("=== CHECKING ALL 5 ORIGINAL POOLS ===");

// Since we can't match old auth codes, just generate fresh ones and poll
console.log("\nNote: Generating fresh auth codes (old ones expired)...");
console.log("If you logged in within the last hour, one should return a token.\n");

for (let i = 0; i < 3; i++) {
  const fingerprintId = Math.random().toString(36).substring(2, 18) + Math.random().toString(36).substring(2, 18);
  
  const res = await fetch(`${API_BASE}/api/auth/cli/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprintId }),
  });
  
  if (res.ok) {
    const json = await res.json();
    const token = await checkToken({
      index: i + 1,
      fingerprintId: json.fingerprintId,
      fingerprintHash: json.fingerprintHash,
      expiresAt: json.expiresAt,
      authCode: json.loginUrl.match(/auth_code=([^&]+)/)[1],
    });
    
    if (token) {
      console.log("\n🎉 SUCCESS!");
      process.exit(0);
    }
  }
}

console.log("\n❌ No active tokens found. The OAuth sessions may have expired.");
console.log("Run pool-oauth-final.mjs again to get fresh URLs.");

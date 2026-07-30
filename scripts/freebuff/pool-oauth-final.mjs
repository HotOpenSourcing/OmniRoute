#!/usr/bin/env node
/**
 * OAuth pool listener - Final working version.
 * 
 * Discovery: Server returns fingerprintHash + loginUrl directly in response.
 * No need to calculate hash client-side.
 */

import { randomBytes } from "crypto";
import { writeFileSync } from "fs";

const API_BASE = "https://www.codebuff.com";
const OUTPUT_FILE = "C:\\Users\\amine\\OmniRoute\\scripts\\freebuff\\captured-token.json";

function generateFingerprintId() {
  return randomBytes(16).toString("hex");
}

async function requestAuthCode(fingerprintId) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/cli/code`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "codebuff-cli/1.0.0",
      },
      body: JSON.stringify({ fingerprintId }),
    });

    if (!res.ok) {
      console.log(`[ERR] Auth code request failed: ${res.status}`);
      return null;
    }

    const json = await res.json();
    return {
      fingerprintId: json.fingerprintId,
      fingerprintHash: json.fingerprintHash,
      loginUrl: json.loginUrl,
      expiresAt: new Date(json.expiresAt).toISOString(),
    };
  } catch (err) {
    console.log(`[ERR] requestAuthCode: ${err.message}`);
    return null;
  }
}

async function pollStatus(pool, index) {
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${pool.fingerprintId}&fingerprintHash=${pool.fingerprintHash}&expiresAt=${encodeURIComponent(pool.expiresAt)}`;
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes (5s interval)

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "codebuff-cli/1.0.0" },
      });
      const json = await res.json();

      if (res.status === 200 && json.authToken) {
        console.log(`\n\n✅ [POOL ${index}] TOKEN CAPTURED!`);
        console.log(`Token: ${json.authToken}`);
        console.log(`Email: ${json.email || "N/A"}`);
        
        const tokenData = {
          token: json.authToken,
          email: json.email,
          fingerprintId: pool.fingerprintId,
          fingerprintHash: pool.fingerprintHash,
          capturedAt: new Date().toISOString(),
        };

        writeFileSync(OUTPUT_FILE, JSON.stringify(tokenData, null, 2));
        console.log(`\n💾 Token saved to: ${OUTPUT_FILE}`);
        return json.authToken;
      }

      if (res.status === 401) {
        // Still waiting for OAuth
        process.stdout.write(`\r[POOL ${index}] Polling... (${attempts}/${maxAttempts})   `);
      } else {
        console.log(`\n[POOL ${index}] Status ${res.status}: ${JSON.stringify(json)}`);
      }
    } catch (err) {
      console.log(`\n[POOL ${index}] Poll error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 5000)); // 5s interval
  }

  console.log(`\n❌ [POOL ${index}] Timeout after ${maxAttempts} attempts`);
  return null;
}

// === Main flow ===
console.log("=== FREEBUFF OAUTH POOL LISTENER ===\n");

const poolCount = 5;
const pools = [];

console.log("📋 Requesting auth codes...\n");
for (let i = 1; i <= poolCount; i++) {
  const fingerprintId = generateFingerprintId();
  const pool = await requestAuthCode(fingerprintId);
  
  if (pool) {
    pool.index = i;
    pools.push(pool);
    console.log(`[POOL ${i}] ${pool.loginUrl}`);
  } else {
    console.log(`[POOL ${i}] ❌ Failed to get auth code`);
  }
}

if (pools.length === 0) {
  console.log("\n❌ No valid auth codes received. Exiting.");
  process.exit(1);
}

console.log("\n\n🎯 Choose ONE URL above and login with GitHub in your browser.");
console.log("⏳ Listening for token response (5s polling, 10min timeout)...\n");

// Start polling all pools in parallel
const pollPromises = pools.map((p) => pollStatus(p, p.index));

const token = await Promise.race(pollPromises);

if (token) {
  console.log("\n\n🎉 SUCCESS! Token captured and saved.");
  process.exit(0);
} else {
  console.log("\n\n❌ All pools timed out. No token received.");
  process.exit(1);
}

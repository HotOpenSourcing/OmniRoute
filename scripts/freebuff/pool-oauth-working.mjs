#!/usr/bin/env node
/**
 * Working OAuth pool listener with correct expiresAt format (number).
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

    if (!res.ok) return null;

    const json = await res.json();
    return {
      fingerprintId: json.fingerprintId,
      fingerprintHash: json.fingerprintHash,
      loginUrl: json.loginUrl,
      expiresAt: json.expiresAt, // Keep as number!
    };
  } catch (err) {
    return null;
  }
}

async function pollStatus(pool, index) {
  // KEY FIX: expiresAt must be a NUMBER, not an ISO string
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${pool.fingerprintId}&fingerprintHash=${pool.fingerprintHash}&expiresAt=${pool.expiresAt}`;
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes

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
        
        writeFileSync(OUTPUT_FILE, JSON.stringify({
          token: json.authToken,
          email: json.email,
          fingerprintId: pool.fingerprintId,
          capturedAt: new Date().toISOString(),
        }, null, 2));
        
        console.log(`\n💾 Saved to: ${OUTPUT_FILE}`);
        return json.authToken;
      }

      if (res.status === 401) {
        // Still waiting
        process.stdout.write(`\r[POOL ${index}] Polling... (${attempts}/${maxAttempts})   `);
      } else {
        console.log(`\n[POOL ${index}] [${res.status}] ${JSON.stringify(json)}`);
      }
    } catch (err) {
      console.log(`\n[POOL ${index}] Error: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log(`\n❌ [POOL ${index}] Timeout`);
  return null;
}

// === Main ===
console.log("=== FREEBUFF OAUTH POOL (FIXED) ===\n");

const poolCount = 5;
const pools = [];

console.log("📋 Requesting auth codes...\n");
for (let i = 1; i <= poolCount; i++) {
  const pool = await requestAuthCode(generateFingerprintId());
  
  if (pool) {
    pool.index = i;
    pools.push(pool);
    console.log(`[POOL ${i}] ${pool.loginUrl}`);
  } else {
    console.log(`[POOL ${i}] ❌ Failed`);
  }
}

if (pools.length === 0) {
  console.log("\n❌ No auth codes received. Exiting.");
  process.exit(1);
}

console.log("\n\n🎯 Choose ONE URL above and login with GitHub.");
console.log("⏳ Listening for token (5s interval, 10min timeout)...\n");

const pollPromises = pools.map((p) => pollStatus(p, p.index));
const token = await Promise.race(pollPromises);

if (token) {
  console.log("\n\n🎉 SUCCESS!");
  process.exit(0);
} else {
  console.log("\n\n❌ All pools timed out.");
  process.exit(1);
}

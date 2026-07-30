#!/usr/bin/env node
/**
 * Pool OAuth with persistent listening for token response.
 * 
 * Flow:
 * 1. Generate 5 random fingerprint IDs (not hashes)
 * 2. For each ID: POST /api/auth/cli/code with fingerprintId → get authCode
 * 3. Print login URLs for manual browser OAuth
 * 4. Poll /api/auth/cli/status in parallel until one returns token
 * 5. Save token to file when received
 */

import { createHash, randomBytes } from "crypto";
import { writeFileSync } from "fs";

const API_BASE = "https://www.codebuff.com";
const OUTPUT_FILE = "C:\\Users\\amine\\OmniRoute\\scripts\\freebuff\\captured-token.json";

function generateFingerprintId() {
  return randomBytes(16).toString("hex");
}

function generateHash(fingerprintId) {
  return createHash("sha256").update(fingerprintId).digest("hex");
}

function expiresAt() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

async function requestAuthCode(fingerprintId) {
  try {
    const res = await fetch(`${API_BASE}/api/auth/cli/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprintId }),
    });
    const json = await res.json();
    return json.authCode;
  } catch (err) {
    console.log(`[ERR] requestAuthCode: ${err.message}`);
    return null;
  }
}

async function pollStatus(fingerprintId, fingerprintHash, expiresAt, index) {
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${fingerprintId}&fingerprintHash=${fingerprintHash}&expiresAt=${encodeURIComponent(expiresAt)}`;
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes (5s interval)

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await fetch(url);
      const json = await res.json();

      if (res.status === 200 && json.authToken) {
        console.log(`\n✅ [POOL ${index}] TOKEN CAPTURED!`);
        console.log(`Token: ${json.authToken}`);
        console.log(`Email: ${json.email || "N/A"}`);
        
        writeFileSync(
          OUTPUT_FILE,
          JSON.stringify(
            {
              token: json.authToken,
              email: json.email,
              fingerprintId,
              fingerprintHash,
              capturedAt: new Date().toISOString(),
            },
            null,
            2
          )
        );
        console.log(`\n💾 Token saved to: ${OUTPUT_FILE}`);
        return json.authToken;
      }

      if (res.status === 401) {
        // Still waiting for OAuth
        process.stdout.write(`\r[POOL ${index}] Polling... (attempt ${attempts}/${maxAttempts})   `);
      } else {
        console.log(`\n[POOL ${index}] Unexpected status: ${res.status}`);
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

const pools = Array.from({ length: 5 }, (_, i) => ({
  index: i + 1,
  fingerprintId: generateFingerprintId(),
}));

// Generate hashes and expires for each pool
for (const pool of pools) {
  pool.fingerprintHash = generateHash(pool.fingerprintId);
  pool.expires = expiresAt();
}

console.log("📋 Requesting auth codes...\n");
for (const pool of pools) {
  const authCode = await requestAuthCode(pool.fingerprintId);
  if (authCode) {
    pool.authCode = authCode;
    pool.loginUrl = `https://www.codebuff.com/login?auth_code=${authCode}`;
    console.log(`[POOL ${pool.index}] ${pool.loginUrl}`);
  } else {
    console.log(`[POOL ${pool.index}] ❌ Failed to get auth code`);
  }
}

const validPools = pools.filter((p) => p.authCode);

if (validPools.length === 0) {
  console.log("\n❌ No valid auth codes received. Exiting.");
  process.exit(1);
}

console.log("\n\n🎯 Choose ONE URL above and login with GitHub in your browser.");
console.log("⏳ Listening for token response (5s polling, 10min timeout)...\n");

// Start polling all valid pools in parallel
const pollPromises = validPools.map((p) =>
  pollStatus(p.fingerprintId, p.fingerprintHash, p.expires, p.index)
);

const token = await Promise.race(pollPromises);

if (token) {
  console.log("\n\n🎉 SUCCESS! Token captured and saved.");
  process.exit(0);
} else {
  console.log("\n\n❌ All pools timed out. No token received.");
  process.exit(1);
}

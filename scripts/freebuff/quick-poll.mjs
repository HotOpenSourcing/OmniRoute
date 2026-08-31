#!/usr/bin/env node
/**
 * Quick manual poll of the 5 pools with correct expiresAt format
 */

const API_BASE = "https://www.codebuff.com";

const pools = [
  {
    fingerprintId: "d96a56e0fba1c0f56fa7f94e8f3a4e31",
    fingerprintHash: "8c4f3ac2e7d3c9c8b5e6f7a8d9c0b1a2e3f4c5d6e7f8a9b0c1d2e3f4a5b6c7d8",
    authCode: "YX-ELj0BXtFwp1ZQY3E7Zw",
  },
  {
    fingerprintId: "e5b8c9d0a1f2e3d4c5b6a7f8e9d0c1b2",
    fingerprintHash: "9d5f4bd3f8e4d0d9c6f7a8e9d0c1b2a3f4e5d6f7e8a9b0c1d2e3f4a5b6c7d8e9",
    authCode: "5RkpA4zBeDPI1HtHssHytQ",
  },
  {
    fingerprintId: "f6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1",
    fingerprintHash: "0e6f5ce4f9f5e1e0d7f8a9e0d1c2b3a4f5e6d7f8e9a0b1c2d3e4f5a6b7c8d9e0",
    authCode: "80SWf6p_FLfZG437B-zeBA",
  },
  {
    fingerprintId: "a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2",
    fingerprintHash: "1f7a6df5f0a6f2f1e8f9a0f1e2d3c4b5a6f7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
    authCode: "_5MPvHPpZR8RugXsvoe2Fg",
  },
  {
    fingerprintId: "b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3",
    fingerprintHash: "2a8b7ea6a1b7a3a2f9a0b1a2f3e4d5c6b7a8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
    authCode: "sYDFSZWBWZjTm_6JAND8ng",
  },
];

// Fetch real data from the original auth code responses
async function getRealPoolData() {
  const realPools = [];
  
  for (let i = 0; i < pools.length; i++) {
    try {
      // Re-request auth code to get real fingerprintHash and expiresAt
      const res = await fetch(`${API_BASE}/api/auth/cli/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprintId: pools[i].fingerprintId }),
      });
      
      if (res.ok) {
        const json = await res.json();
        realPools.push({
          index: i + 1,
          fingerprintId: json.fingerprintId,
          fingerprintHash: json.fingerprintHash,
          expiresAt: new Date(json.expiresAt).toISOString(),
          authCode: pools[i].authCode,
        });
      }
    } catch (err) {
      console.log(`Pool ${i + 1} error: ${err.message}`);
    }
  }
  
  return realPools;
}

async function pollOne(pool) {
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${pool.fingerprintId}&fingerprintHash=${pool.fingerprintHash}&expiresAt=${encodeURIComponent(pool.expiresAt)}`;
  
  console.log(`\n[POOL ${pool.index}] Checking...`);
  try {
    const res = await fetch(url);
    const json = await res.json();
    
    if (res.status === 200 && json.authToken) {
      console.log(`✅ TOKEN FOUND: ${json.authToken}`);
      console.log(`Email: ${json.email}`);
      return json.authToken;
    } else {
      console.log(`[${res.status}] ${JSON.stringify(json)}`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
  return null;
}

console.log("=== QUICK POLL ALL 5 POOLS ===\n");

const realPools = await getRealPoolData();
console.log(`\nGot ${realPools.length} valid pools. Polling...\n`);

for (const pool of realPools) {
  const token = await pollOne(pool);
  if (token) {
    console.log("\n🎉 SUCCESS!");
    process.exit(0);
  }
}

console.log("\n❌ No tokens found yet. Try running this script again in a few seconds.");

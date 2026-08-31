#!/usr/bin/env node
/**
 * Continuous poll with multiple PKCE hashes in parallel.
 * Once any of them returns 200, print the token and exit.
 */

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 150; // 5 minutes max

// Use the LATEST 5 hashes we generated
const hashes = [
  { hash: "9b4e576917b166868515773ff17847a055e6b81236bd3b9af3a459fe9da701a5", expires: "1784056176463" },
  { hash: "4550fc53a479ac6490ff8cd6afdf25ef4a1701b208cbb3858453a95b7d6527f9", expires: "1784056181622" },
  { hash: "5ee7bbbec319862d3494933addfed36b4acb7df07fc00738ed94e40c19797369", expires: "1784056187305" },
  { hash: "f69d92b709bccdc0e96008030134e014230ec9720e33d7483261a8217e76caf9", expires: "1784056192833" },
  { hash: "dfe512882b2869626d2887b834be28461dd6da80384677f87de4a8d8b3e302ff", expires: "1784056197875" },
];

async function pollHash(h, idx) {
  const url = `https://www.codebuff.com/api/auth/cli/status?fingerprintId=&fingerprintHash=${h.hash}&expiresAt=${h.expires}`;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
      });
      if (res.status === 200) {
        const text = await res.text();
        console.log(`\n[#${idx}] ✅✅✅ status: 200 on attempt ${i}`);
        console.log(`[#${idx}] body: ${text}`);
        return { idx, status: 200, body: text, hash: h.hash };
      } else if (i % 5 === 0) {
        console.log(`[#${idx}] [${i}] status: ${res.status}`);
      }
    } catch (err) {
      console.log(`[#${idx}] [${i}] error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

console.log(`[multi-poll] Starting ${hashes.length} parallel pollers...`);
const results = await Promise.all(hashes.map((h, i) => pollHash(h, i)));
const success = results.find((r) => r && r.status === 200);
if (success) {
  console.log(`\n[multi-poll] 🎉 TOKEN CAPTURED with hash #${success.idx}`);
  console.log(`[multi-poll] ${success.body}`);
  process.exit(0);
} else {
  console.log(`[multi-poll] ❌ All hashes timed out`);
  process.exit(1);
}

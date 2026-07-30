#!/usr/bin/env node
// Poll /api/auth/cli/status to retrieve the token after auth completes.

import { setTimeout as sleep } from "node:timers/promises";

const FINGERPRINT_HASH = "230c7b19a7ac71a4b6f290fe247c162b4bf9d325a8221f937518884e252d9d7f";
const EXPIRES_AT = "1784054101343";
const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 60; // 2 minutes max

const url = `https://www.codebuff.com/api/auth/cli/status?fingerprintId=&fingerprintHash=${FINGERPRINT_HASH}&expiresAt=${EXPIRES_AT}`;

console.log(`[poll] Polling ${url}`);
console.log(`[poll] Interval: ${POLL_INTERVAL_MS}ms, Max attempts: ${MAX_ATTEMPTS}`);

let attempt = 0;
while (attempt < MAX_ATTEMPTS) {
  attempt++;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
    });
    console.log(`[poll] [${attempt}] status: ${res.status}`);
    if (res.ok) {
      const text = await res.text();
      console.log(`[poll] body: ${text}`);
      try {
        const json = JSON.parse(text);
        if (json.accessToken || json.token || json.authToken || json.success) {
          console.log(`\n[poll] ✅ TOKEN FOUND!`);
          console.log(JSON.stringify(json, null, 2));
          process.exit(0);
        }
      } catch {}
    }
  } catch (err) {
    console.log(`[poll] [${attempt}] error: ${err.message}`);
  }
  await sleep(POLL_INTERVAL_MS);
}

console.log(`\n[poll] ❌ Timeout after ${MAX_ATTEMPTS} attempts`);
process.exit(1);

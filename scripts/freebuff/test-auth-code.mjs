#!/usr/bin/env node
/**
 * Test /api/auth/cli/code endpoint with debug output
 */

import { randomBytes } from "crypto";

const API_BASE = "https://www.codebuff.com";

async function testAuthCode() {
  const fingerprintId = randomBytes(16).toString("hex");
  const url = `${API_BASE}/api/auth/cli/code`;
  
  console.log(`\n=== TEST AUTH CODE ===`);
  console.log(`URL: ${url}`);
  console.log(`fingerprintId: ${fingerprintId}\n`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "codebuff-cli/1.0.0",
      },
      body: JSON.stringify({ fingerprintId }),
    });

    console.log(`Status: ${res.status}`);
    console.log(`Headers:`, Object.fromEntries(res.headers.entries()));
    
    const text = await res.text();
    console.log(`\nBody: ${text}`);

    if (res.ok) {
      const json = JSON.parse(text);
      if (json.authCode) {
        console.log(`\n✅ Auth code received: ${json.authCode}`);
        console.log(`Login URL: https://www.codebuff.com/login?auth_code=${json.authCode}`);
      }
    }
  } catch (err) {
    console.log(`\n❌ Error: ${err.message}`);
    console.log(`Stack: ${err.stack}`);
  }
}

await testAuthCode();

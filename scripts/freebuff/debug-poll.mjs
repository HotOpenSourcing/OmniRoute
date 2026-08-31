#!/usr/bin/env node
/**
 * Debug exact query params format
 */

import { randomBytes } from "crypto";

const API_BASE = "https://www.codebuff.com";

// Step 1: Request auth code
console.log("=== STEP 1: Request auth code ===\n");
const fingerprintId = randomBytes(16).toString("hex");

const res1 = await fetch(`${API_BASE}/api/auth/cli/code`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ fingerprintId }),
});

const json1 = await res1.json();
console.log("Response:", JSON.stringify(json1, null, 2));

const { fingerprintHash, expiresAt } = json1;

// Step 2: Try different expiresAt formats
console.log("\n=== STEP 2: Poll with different expiresAt formats ===\n");

const formats = [
  { name: "Raw number", value: expiresAt },
  { name: "ISO string", value: new Date(expiresAt).toISOString() },
  { name: "String number", value: String(expiresAt) },
];

for (const format of formats) {
  console.log(`\nTrying format: ${format.name} = ${format.value}`);
  const url = `${API_BASE}/api/auth/cli/status?fingerprintId=${fingerprintId}&fingerprintHash=${fingerprintHash}&expiresAt=${encodeURIComponent(format.value)}`;
  console.log(`URL: ${url.slice(0, 120)}...`);
  
  try {
    const res = await fetch(url);
    const json = await res.json();
    console.log(`[${res.status}]`, JSON.stringify(json));
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}

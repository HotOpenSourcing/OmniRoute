#!/usr/bin/env node
/**
 * Simple SDK call to capture with mitmdump.
 * Uses the codebuff SDK to make a real chat call.
 */

// Set proxy before any imports
process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
process.env.HTTP_PROXY = "http://127.0.0.1:8080";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { CodebuffClient } from "C:/Users/amine/.config/manicode/codebuff/sdk/src/index.ts";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";

console.log("=== CODEBUFF SDK CALL (via mitmdump) ===\n");
console.log("Starting SDK call...\n");

const client = new CodebuffClient({ apiKey: AUTH_TOKEN });

try {
  const result = await client.run({
    agent: "base",
    prompt: "Reply only with: PONG",
  });
  
  console.log("\n✅ SDK call completed!");
  console.log("\nResult:", result.output);
} catch (err) {
  console.log("\n❌ SDK call failed:", err.message);
  console.log("\nError details:", err);
}

console.log("\n🎯 Check mitm capture file for all HTTP requests.");

#!/usr/bin/env node
/**
 * Test exact CLI flow using SDK client.run() method.
 * This mimics how the real CLI calls the API.
 */

// Set proxy for capture
process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
process.env.HTTP_PROXY = "http://127.0.0.1:8080";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { CodebuffClient } from "file:///C:/Users/amine/.config/manicode/codebuff/sdk/src/index.ts";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";
const FREEBUFF_INSTANCE_ID = "e7293706-6391-4e4a-ab7b-7ee32f0ed788";

console.log("=== TESTING SDK CLIENT.RUN() (CLI FLOW) ===\n");
console.log(`Token: ${AUTH_TOKEN}`);
console.log(`Instance ID: ${FREEBUFF_INSTANCE_ID}\n`);

const client = new CodebuffClient({ 
  apiKey: AUTH_TOKEN,
});

console.log("[1] Calling client.run() with freebuff metadata...\n");

try {
  const result = await client.run({
    agent: "base", // Try base first
    prompt: "Reply only with: PONG",
    costMode: "free",
    extraCodebuffMetadata: {
      freebuff_instance_id: FREEBUFF_INSTANCE_ID,
    },
    handleEvent: (event) => {
      if (event.type === "assistant_message_delta") {
        process.stdout.write(event.delta);
      } else if (event.type === "assistant_message_created") {
        console.log("\n[STREAMING STARTED]");
      } else if (event.type === "run_completed") {
        console.log("\n[RUN COMPLETED]");
      }
    },
  });
  
  console.log("\n\n✅ SUCCESS!");
  console.log("\nFinal output:", result.output);
  console.log("\nRun stats:", {
    totalCost: result.totalCost,
    steps: result.steps?.length,
  });
  
} catch (err) {
  console.log("\n\n❌ ERROR:", err.message);
  console.log("\nError details:", err);
  
  if (err.cause) {
    console.log("\nCause:", err.cause);
  }
  
  // Try to extract response body
  if (err.response) {
    try {
      const body = await err.response.text();
      console.log("\nResponse body:", body);
    } catch (e) {
      // Ignore
    }
  }
}

#!/usr/bin/env node
/**
 * Test SDK client.run() - Simple JS version without TypeScript imports.
 */

// Set proxy for capture
process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
process.env.HTTP_PROXY = "http://127.0.0.1:8080";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";
const FREEBUFF_INSTANCE_ID = "e7293706-6391-4e4a-ab7b-7ee32f0ed788";

console.log("=== TESTING SDK VIA DYNAMIC IMPORT ===\n");

async function testSDK() {
  try {
    // Dynamic import of the TypeScript SDK
    const { CodebuffClient } = await import("file:///C:/Users/amine/.config/manicode/codebuff/sdk/src/index.ts");
    
    console.log("✅ SDK imported successfully\n");
    
    const client = new CodebuffClient({ 
      apiKey: AUTH_TOKEN,
    });
    
    console.log("[1] Calling client.run() with freebuff metadata...\n");
    
    const result = await client.run({
      agent: "base",
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
    console.log("\nError name:", err.name);
    console.log("\nStack:", err.stack?.slice(0, 500));
    
    if (err.cause) {
      console.log("\nCause:", err.cause);
    }
  }
}

testSDK();

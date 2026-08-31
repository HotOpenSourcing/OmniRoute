#!/usr/bin/env node
/**
 * Simple SDK call to capture with mitmdump - pure JS version.
 */

// Set proxy before any imports
process.env.HTTPS_PROXY = "http://127.0.0.1:8080";
process.env.HTTP_PROXY = "http://127.0.0.1:8080";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { randomUUID } from "crypto";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";
const BASE_URL = "https://www.codebuff.com";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

console.log("=== CAPTURING SDK FLOW WITH MITMDUMP ===\n");

// Step 1: Join freebuff session
console.log("[1] GET /api/v1/freebuff/session");
const sessionRes = await fetch(`${BASE_URL}/api/v1/freebuff/session`, {
  method: "GET",
  headers,
});
const session = await sessionRes.json();
console.log(`  → [${sessionRes.status}] instanceId: ${session.instanceId || "N/A"}`);

// Step 2: Start agent run
console.log("\n[2] POST /api/v1/agent-runs (START)");
const runRes = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "START",
    agentId: "base",
    ancestorRunIds: [],
  }),
});
const runData = await runRes.json();
console.log(`  → [${runRes.status}] runId: ${runData.runId || "N/A"}`);

// Step 3: Chat completion (will fail but we want to capture the request)
console.log("\n[3] POST /api/v1/chat/completions");
const chatRes = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
  method: "POST",
  headers: {
    ...headers,
    "x-freebuff-instance-id": session.instanceId,
  },
  body: JSON.stringify({
    model: session.model || "mimo/mimo-v2.5",
    messages: [
      {
        role: "user",
        content: "Reply: PONG",
      },
    ],
    max_tokens: 50,
    stream: false,
    codebuff_metadata: {
      run_id: runData.runId,
      client_id: randomUUID(),
      freebuff_instance_id: session.instanceId,
      cost_mode: "free",
    },
  }),
});
const chatJson = await chatRes.json();
console.log(`  → [${chatRes.status}] ${chatJson.error || "OK"}`);

// Step 4: Finish run
console.log("\n[4] POST /api/v1/agent-runs (FINISH)");
const finishRes = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "FINISH",
    runId: runData.runId,
    status: "completed",
    totalSteps: 1,
    directCredits: 0,
    totalCredits: 0,
  }),
});
const finishJson = await finishRes.json();
console.log(`  → [${finishRes.status}] ${finishJson.success ? "✅" : "❌"}`);

console.log("\n\n🎯 All requests captured in mitm dump file!");
console.log("Check C:\\Users\\amine\\freebuff-real.mitm for captured traffic.");

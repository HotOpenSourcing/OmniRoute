#!/usr/bin/env node
/**
 * Test with correct freebuff agent: base2-free (not "base").
 * This is the agent freebuff CLI actually uses in LITE mode.
 */

import { randomUUID } from "crypto";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";
const BASE_URL = "https://www.codebuff.com";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "text/event-stream",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

console.log("=== TESTING WITH CORRECT FREEBUFF AGENT ===\n");

// Step 1: Get session
console.log("[1] GET /api/v1/freebuff/session");
const sessionRes = await fetch(`${BASE_URL}/api/v1/freebuff/session`, {
  method: "GET",
  headers,
});
const session = await sessionRes.json();
console.log(`  → [${sessionRes.status}] instanceId: ${session.instanceId}, model: ${session.model}`);

// Step 2: Start run with CORRECT agent
console.log("\n[2] POST /api/v1/agent-runs (START with base2-free)");
const runRes = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "START",
    agentId: "base2-free", // ← CORRECT FREEBUFF AGENT
    ancestorRunIds: [],
  }),
});
const runData = await runRes.json();
console.log(`  → [${runRes.status}] runId: ${runData.runId || "N/A"}`);

if (!runData.runId) {
  console.log("\n❌ Failed to get runId:", runData);
  process.exit(1);
}

// Step 3: Chat completion
console.log("\n[3] POST /api/v1/chat/completions (stream=true)");
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
        content: "Reply only with: PONG",
      },
    ],
    max_tokens: 50,
    stream: true,
    codebuff_metadata: {
      run_id: runData.runId,
      client_id: randomUUID(),
      freebuff_instance_id: session.instanceId,
      cost_mode: "free", // ← CORRECT COST MODE FOR FREEBUFF
    },
  }),
});

console.log(`  → Status: ${chatRes.status}`);
console.log(`  → Content-Type: ${chatRes.headers.get("content-type")}`);

if (chatRes.status === 200) {
  console.log("\n✅ STREAMING STARTED!\n");
  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          console.log("\n\n[DONE]");
        } else {
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              process.stdout.write(delta);
            }
          } catch (err) {
            // Skip non-JSON lines
          }
        }
      }
    }
  }
  
  console.log("\n\n🎉🎉🎉 STREAMING CHAT SUCCESS! 🎉🎉🎉");
} else {
  const text = await chatRes.text();
  console.log(`\n❌ Error: ${text.slice(0, 500)}`);
}

// Step 4: Finish run
console.log("\n[4] POST /api/v1/agent-runs (FINISH)");
const finishRes = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "FINISH",
    runId: runData.runId,
    status: chatRes.status === 200 ? "completed" : "failed",
    totalSteps: 1,
    directCredits: 0,
    totalCredits: 0,
  }),
});
const finishJson = await finishRes.json();
console.log(`  → [${finishRes.status}] ${finishJson.success ? "✅" : "❌"}`);

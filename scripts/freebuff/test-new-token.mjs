#!/usr/bin/env node
/**
 * Test new captured token with real chat completion.
 * 
 * Full flow:
 * 1. POST /api/v1/freebuff/session (join freebuff session)
 * 2. POST /api/v1/agent-runs (start agent run) → get runId
 * 3. POST /api/v1/chat/completions with runId + instance_id
 */

import { randomUUID } from "crypto";

const AUTH_TOKEN = "d3546b5b-5f79-4b6f-88cc-375ed6b02324";
const BASE_URL = "https://www.codebuff.com";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

console.log("=== FREEBUFF CHAT COMPLETION TEST ===\n");
console.log(`Token: ${AUTH_TOKEN}\n`);

// Step 1: Join freebuff session
console.log("=== STEP 1: Join Freebuff Session ===");
const sessionRes = await fetch(`${BASE_URL}/api/v1/freebuff/session`, {
  method: "POST",
  headers: {
    ...headers,
    "x-freebuff-model": "deepseek/deepseek-v4-flash",
  },
});

const session = await sessionRes.json();
console.log(`[${sessionRes.status}]`, JSON.stringify(session, null, 2));

if (sessionRes.status !== 200 || !session.instanceId) {
  console.log("\n❌ Failed to join freebuff session. Exiting.");
  process.exit(1);
}

const instanceId = session.instanceId;
console.log(`\n✅ Session active! instanceId: ${instanceId}`);

// Step 2: Start agent run
console.log("\n=== STEP 2: Start Agent Run ===");
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
console.log(`[${runRes.status}]`, JSON.stringify(runData, null, 2));

if (runRes.status !== 200 || !runData.runId) {
  console.log("\n❌ Failed to start agent run. Exiting.");
  process.exit(1);
}

const runId = runData.runId;
console.log(`\n✅ Agent run started! runId: ${runId}`);

// Step 3: Chat completion
console.log("\n=== STEP 3: Chat Completion ===");
const chatRes = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
  method: "POST",
  headers: {
    ...headers,
    "x-freebuff-instance-id": instanceId,
  },
  body: JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    messages: [
      {
        role: "user",
        content: "Reply only with the word: PONG",
      },
    ],
    max_tokens: 50,
    stream: false,
    codebuff_metadata: {
      run_id: runId,
      client_id: randomUUID(),
      freebuff_instance_id: instanceId,
      cost_mode: "free",
    },
  }),
});

const chatText = await chatRes.text();
console.log(`[${chatRes.status}]`);

try {
  const chatJson = JSON.parse(chatText);
  console.log(JSON.stringify(chatJson, null, 2));
  
  if (chatRes.status === 200 && chatJson.choices) {
    console.log("\n\n🎉🎉🎉 CHAT COMPLETION SUCCESS! 🎉🎉🎉");
    console.log("\nResponse:", chatJson.choices[0].message.content);
  }
} catch (err) {
  console.log(chatText.slice(0, 2000));
}

// Step 4: Finish agent run
console.log("\n=== STEP 4: Finish Agent Run ===");
const finishRes = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    action: "FINISH",
    runId,
    status: chatRes.status === 200 ? "completed" : "failed",
    totalSteps: 1,
    directCredits: 0,
    totalCredits: 0,
  }),
});

const finishData = await finishRes.json();
console.log(`[${finishRes.status}]`, JSON.stringify(finishData, null, 2));

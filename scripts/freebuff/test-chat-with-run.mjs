#!/usr/bin/env node
/**
 * Full chat completion flow with proper run registration.
 * 
 * Flow discovered from SDK:
 * 1. POST /api/v1/agent-runs (START) → get runId
 * 2. POST /api/v1/chat/completions with runId in codebuff_metadata
 * 3. POST /api/v1/agent-runs (FINISH) with runId
 */

import { randomUUID } from "crypto";

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const SESSION_INSTANCE_ID = "1d3cecd8-8bcf-46d2-a7d3-1a87b1e8a4fe";
const BASE_URL = "https://www.codebuff.com";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

async function startAgentRun(agentId) {
  const url = `${BASE_URL}/api/v1/agent-runs`;
  console.log(`\n=== START AGENT RUN (agentId: ${agentId}) ===`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "START",
        agentId,
        ancestorRunIds: [],
      }),
    });
    const json = await res.json();
    console.log(`[${res.status}]`, JSON.stringify(json, null, 2));
    return json.runId;
  } catch (err) {
    console.log(`[ERR] ${err.message}`);
    return null;
  }
}

async function chatComplete(runId, clientSessionId) {
  const url = `${BASE_URL}/api/v1/chat/completions`;
  console.log(`\n=== CHAT COMPLETION (runId: ${runId}) ===`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "x-freebuff-instance-id": SESSION_INSTANCE_ID,
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        messages: [{ role: "user", content: "Reply only with the word: PONG" }],
        max_tokens: 50,
        stream: false,
        codebuff_metadata: {
          run_id: runId,
          client_id: clientSessionId,
          freebuff_instance_id: SESSION_INSTANCE_ID,
          cost_mode: "free",
        },
      }),
    });
    const text = await res.text();
    console.log(`[${res.status}] ${text.slice(0, 2000)}`);
    return { status: res.status, body: text };
  } catch (err) {
    console.log(`[ERR] ${err.message}`);
    return { status: "ERR", body: err.message };
  }
}

async function finishAgentRun(runId, status) {
  const url = `${BASE_URL}/api/v1/agent-runs`;
  console.log(`\n=== FINISH AGENT RUN (runId: ${runId}, status: ${status}) ===`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "FINISH",
        runId,
        status,
      }),
    });
    const json = await res.json();
    console.log(`[${res.status}]`, JSON.stringify(json, null, 2));
  } catch (err) {
    console.log(`[ERR] ${err.message}`);
  }
}

// === Full flow ===
const agentId = "base";
const clientSessionId = randomUUID();

const runId = await startAgentRun(agentId);
if (runId) {
  const result = await chatComplete(runId, clientSessionId);
  const finalStatus = result.status === 200 ? "SUCCESS" : "ERROR";
  await finishAgentRun(runId, finalStatus);
} else {
  console.log("\n❌ Failed to start agent run, skipping chat completion.");
}

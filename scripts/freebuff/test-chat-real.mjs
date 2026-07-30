#!/usr/bin/env node
/**
 * Real chat completion test with all required metadata from SDK analysis.
 * 
 * Requirements discovered:
 * - URL: https://www.codebuff.com/api/v1/chat/completions
 * - Headers: Authorization (Bearer token), x-freebuff-instance-id
 * - Body: codebuff_metadata with run_id, client_id, freebuff_instance_id
 */

import { randomUUID } from "crypto";

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const SESSION_INSTANCE_ID = "1d3cecd8-8bcf-46d2-a7d3-1a87b1e8a4fe";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
  "x-freebuff-instance-id": SESSION_INSTANCE_ID,
};

async function chatComplete(body, label) {
  const url = "https://www.codebuff.com/api/v1/chat/completions";
  console.log(`\n=== ${label} ===`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`[${res.status}] ${text.slice(0, 2000)}`);
    return { status: res.status, body: text };
  } catch (err) {
    console.log(`[ERR] ${err.message}`);
    return { status: "ERR", body: err.message };
  }
}

const runId = randomUUID();
const clientSessionId = randomUUID();

// Test 1: Simple completion with full metadata
await chatComplete(
  {
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
  },
  "TEST 1: deepseek/deepseek-v4-flash with full metadata"
);

// Test 2: Try streaming
await chatComplete(
  {
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: "Count from 1 to 3" }],
    max_tokens: 50,
    stream: true,
    codebuff_metadata: {
      run_id: randomUUID(),
      client_id: clientSessionId,
      freebuff_instance_id: SESSION_INSTANCE_ID,
      cost_mode: "free",
    },
  },
  "TEST 2: deepseek/deepseek-v4-flash streaming"
);

// Test 3: Try mimo model
await chatComplete(
  {
    model: "mimo/mimo-v2.5",
    messages: [{ role: "user", content: "Say HELLO" }],
    max_tokens: 30,
    stream: false,
    codebuff_metadata: {
      run_id: randomUUID(),
      client_id: clientSessionId,
      freebuff_instance_id: SESSION_INSTANCE_ID,
      cost_mode: "free",
    },
  },
  "TEST 3: mimo/mimo-v2.5 with full metadata"
);

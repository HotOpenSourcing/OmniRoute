#!/usr/bin/env node
/**
 * Real chat completion test with captured freebuff auth token.
 * Confirmed endpoint from SDK source: https://api.codebuff.com/v1/chat/completions
 */

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const SESSION_INSTANCE_ID = "1d3cecd8-8bcf-46d2-a7d3-1a87b1e8a4fe";

const headers = {
  "User-Agent": "ai-sdk/openai-compatible/1.0.0/codebuff",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
  "x-freebuff-instance-id": SESSION_INSTANCE_ID,
};

async function chatComplete(url, body, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url}`);
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

const urls = [
  "https://api.codebuff.com/v1/chat/completions",
  "https://www.codebuff.com/api/v1/chat/completions",
  "https://codebuff.com/api/v1/chat/completions",
];

const body = {
  model: "deepseek/deepseek-v4-flash",
  messages: [{ role: "user", content: "Reply only with the word: PONG" }],
  max_tokens: 50,
  stream: false,
};

for (const url of urls) {
  await chatComplete(url, body, `POST ${url}`);
}

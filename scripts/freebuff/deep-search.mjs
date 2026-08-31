#!/usr/bin/env node
/**
 * Deep search for chat completions endpoint on codebuff.com
 * Try various patterns including /api/v1/chat, /v1/chat, etc.
 */

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";

const bases = [
  "https://www.codebuff.com",
  "https://codebuff.com",
  "https://freebuff.com",
  "https://www.freebuff.com",
];

const chatPaths = [
  "/api/v1/chat/completions",
  "/api/chat/completions",
  "/v1/chat/completions",
  "/api/v1/chat",
  "/api/chat",
  "/chat",
  "/chat/completions",
  "/api/v1/completions",
  "/api/v1/responses",
  "/api/responses",
  "/api/v1/generate",
  "/api/generate",
  "/api/v1/run",
  "/api/run",
  "/api/v1/agents/run",
  "/api/agents/run",
  "/api/v1/inference",
  "/api/inference",
];

async function probe(base, path) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    const text = await res.text();
    const tag = res.status === 200 ? "✅" :
                res.status === 401 ? "🔒" :
                res.status === 403 ? "🚫" :
                res.status === 404 ? "❌" :
                res.status === 405 ? "❓" :
                res.status === 500 ? "💥" : "❔";
    let info = text.slice(0, 200);
    if (text.includes("<!DOCTYPE html>")) info = "(HTML)";
    return { url, status: res.status, tag, info };
  } catch (err) {
    return { url, status: "ERR", tag: "💥", info: err.message };
  }
}

console.log("=== CHAT ENDPOINT DEEP SEARCH ===\n");

const results = [];
for (const base of bases) {
  console.log(`\n--- ${base} ---`);
  for (const path of chatPaths) {
    const r = await probe(base, path);
    results.push(r);
    console.log(`${r.tag} [${r.status}] ${path.padEnd(30)} ${r.info}`);
  }
}

console.log("\n=== INTERESTING ENDPOINTS ===");
const interesting = results.filter((r) => r.status !== 404 && r.status !== "ERR" && r.status !== 405);
for (const r of interesting) {
  console.log(`${r.tag} [${r.status}] ${r.url}`);
  if (r.info) console.log(`     ${r.info}`);
}

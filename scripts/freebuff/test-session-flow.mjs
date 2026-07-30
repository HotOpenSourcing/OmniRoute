#!/usr/bin/env node
/**
 * Test the full freebuff flow with the captured authToken.
 * - GET /api/v1/freebuff/session (probe)
 * - POST /api/v1/freebuff/session (join)
 * - GET /api/v1/me (verify token)
 */

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const API_BASE = "https://www.codebuff.com";

const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${AUTH_TOKEN}`,
};

async function probe(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
    const text = await res.text();
    return { url, status: res.status, body: text };
  } catch (err) {
    return { url, status: "ERR", body: err.message };
  }
}

console.log("=== TEST 1: GET /api/v1/me (verify token) ===");
const me = await probe("/api/v1/me");
console.log(`[${me.status}] ${me.body.slice(0, 500)}\n`);

console.log("=== TEST 2: GET /api/v1/freebuff/session (probe) ===");
const session = await probe("/api/v1/freebuff/session");
console.log(`[${session.status}] ${session.body.slice(0, 500)}\n`);

console.log("=== TEST 3: POST /api/v1/freebuff/session (join, default model) ===");
const join = await probe("/api/v1/freebuff/session", {
  method: "POST",
  headers: { "x-freebuff-model": "sonnet" },
});
console.log(`[${join.status}] ${join.body.slice(0, 1000)}\n`);

console.log("=== TEST 4: POST /api/v1/freebuff/session (join, gpt-5) ===");
const join2 = await probe("/api/v1/freebuff/session", {
  method: "POST",
  headers: { "x-freebuff-model": "gpt-5" },
});
console.log(`[${join2.status}] ${join2.body.slice(0, 1000)}\n`);

console.log("=== TEST 5: POST /api/v1/freebuff/session (join, opus) ===");
const join3 = await probe("/api/v1/freebuff/session", {
  method: "POST",
  headers: { "x-freebuff-model": "opus" },
});
console.log(`[${join3.status}] ${join3.body.slice(0, 1000)}\n`);

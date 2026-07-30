#!/usr/bin/env node
/**
 * Test the captured authToken against real codebuff.com API endpoints.
 * Validates:
 *  - GET /api/auth/me or /api/v1/auth/me
 *  - GET /api/v1/user or /api/v1/me
 *  - POST /api/v1/chat/completions with a tiny request
 */

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const FINGERPRINT_HASH = "dfe512882b2869626d2887b834be28461dd6da80384677f87de4a8d8b3e302ff";

const API_BASE = "https://www.codebuff.com";
const FREE_BASE = "https://freebuff.com";

const tests = [
  { name: "GET /api/auth/me", url: `${API_BASE}/api/auth/me`, headers: {} },
  { name: "GET /api/v1/auth/me", url: `${API_BASE}/api/v1/auth/me`, headers: {} },
  { name: "GET /api/v1/me", url: `${API_BASE}/api/v1/me`, headers: {} },
  { name: "GET /api/v1/user", url: `${API_BASE}/api/v1/user`, headers: {} },
  { name: "GET /api/v1/account", url: `${API_BASE}/api/v1/account`, headers: {} },
  { name: "GET /api/v1/credits", url: `${API_BASE}/api/v1/credits`, headers: {} },
  { name: "GET /api/v1/usage", url: `${API_BASE}/api/v1/usage`, headers: {} },
  { name: "GET /api/v1/models", url: `${API_BASE}/api/v1/models`, headers: {} },
  { name: "POST /api/v1/chat/completions", url: `${API_BASE}/api/v1/chat/completions`, method: "POST", body: {
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 5,
  } },
];

async function runTest(t) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Accept: "application/json",
    ...t.headers,
  };
  const authVariants = [
    { auth: `Bearer ${AUTH_TOKEN}` },
    { Authorization: AUTH_TOKEN },
    { "x-codebuff-token": AUTH_TOKEN },
    { Cookie: `authToken=${AUTH_TOKEN}` },
    {},
  ];

  const opts = { method: t.method || "GET", headers };
  if (t.body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(t.body);
  }

  const results = [];
  for (const v of authVariants) {
    const finalHeaders = { ...headers, ...v };
    try {
      const res = await fetch(t.url, { ...opts, headers: finalHeaders });
      const text = await res.text();
      const variantLabel = Object.entries(v).map(([k, val]) => `${k}: ${val.slice(0, 30)}`).join(" | ") || "(no auth)";
      results.push({ variant: variantLabel, status: res.status, body: text.slice(0, 300) });
      if (res.status === 200) {
        return { test: t.name, success: true, results };
      }
    } catch (err) {
      results.push({ variant: Object.keys(v)[0] || "(none)", status: "ERR", body: err.message });
    }
  }
  return { test: t.name, success: false, results };
}

console.log("=== TESTING AUTH TOKEN ACROSS ENDPOINTS ===\n");
for (const t of tests) {
  console.log(`\n--- ${t.name} ---`);
  const r = await runTest(t);
  for (const res of r.results) {
    const tag = res.status === 200 ? "✅" : res.status === 401 ? "🔒" : res.status === 403 ? "🚫" : res.status === 404 ? "❌" : "❓";
    console.log(`  ${tag} [${res.status}] ${res.variant}`);
    if (res.body.trim()) console.log(`     ${res.body.slice(0, 250)}`);
  }
}

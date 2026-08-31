#!/usr/bin/env node
/**
 * Discover the REAL endpoint structure used by codebuff.com.
 * Maps API paths and their auth requirements.
 */

const AUTH_TOKEN = "dea815ba-d53a-4ade-8790-0b638fe6ffb3";
const API_BASE = "https://www.codebuff.com";

// Endpoints discovered from CLI source + typical conventions
const endpoints = [
  // Path enumeration
  "/api/auth/cli/status",
  "/api/auth/cli/login",
  "/api/auth/cli/refresh",
  "/api/auth/cli/logout",
  "/api/auth/me",
  "/api/auth/user",
  "/api/auth/session",
  "/api/me",
  "/api/user",
  "/api/user/me",
  "/api/account",
  "/api/account/me",
  "/api/credits",
  "/api/usage",
  "/api/subscription",
  "/api/v1",
  "/api/v1/",
  // CLI specific
  "/api/v1/agents",
  "/api/v1/sessions",
  "/api/v1/runs",
  "/api/v1/usage",
  "/api/v1/billing",
  // Common auth
  "/api/whoami",
  "/api/identity",
  // Health check
  "/health",
  "/healthz",
  "/api/health",
  // Root
  "/",
];

async function probe(path) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
    });
    const text = await res.text();
    const tag = res.status === 200 ? "✅" :
                res.status === 401 ? "🔒" :
                res.status === 403 ? "🚫" :
                res.status === 404 ? "❌" :
                res.status === 405 ? "❓" :
                res.status === 500 ? "💥" : "❔";
    let info = text.slice(0, 200);
    if (text.includes("<!DOCTYPE html>")) info = "(HTML page)";
    return { path, status: res.status, tag, info };
  } catch (err) {
    return { path, status: "ERR", tag: "💥", info: err.message };
  }
}

console.log("=== ENDPOINT DISCOVERY ===\n");
console.log(`Token: ${AUTH_TOKEN}`);
console.log(`Base: ${API_BASE}\n`);

const results = [];
for (const e of endpoints) {
  const r = await probe(e);
  results.push(r);
  console.log(`${r.tag} [${r.status}] ${r.path.padEnd(30)} ${r.info}`);
}

console.log("\n=== SUMMARY ===");
const byStatus = {};
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
}
for (const [s, c] of Object.entries(byStatus)) {
  console.log(`  ${s}: ${c} endpoints`);
}

console.log("\n=== AUTHENTICATED (2xx) ===");
for (const r of results) {
  if (r.status >= 200 && r.status < 300) console.log(`  ${r.path}`);
}

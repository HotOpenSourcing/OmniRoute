#!/usr/bin/env node
/**
 * Poll /api/auth/cli/status with multiple parameter combinations
 * until the server returns 200 with a token.
 *
 * Tests:
 *  - Plain (no auth)
 *  - With fingerprintId only
 *  - With fingerprintHash only
 *  - With expiresAt only
 *  - With all
 *  - With auth_code directly
 *  - With Cookie: fingerprintHash=...
 *  - With Authorization header
 *  - POST instead of GET
 */

const CODEBUFF_API = "https://www.codebuff.com";
const FINGERPRINT_HASH = process.env.FP_HASH || "e0b2f2bec3168d4dcfdba31e7174a2bd6536c454991e62835cb880ed7e8b0ac5";
const EXPIRES_AT = process.env.FP_EXPIRES || "1784055823571";
const AUTH_CODE = process.env.AUTH_CODE || "RkQFofvrPoHHQWqwciFrWg";

const tests = [
  { name: "GET no params", url: `${CODEBUFF_API}/api/auth/cli/status`, method: "GET" },
  { name: "GET hash only", url: `${CODEBUFF_API}/api/auth/cli/status?fingerprintHash=${FINGERPRINT_HASH}`, method: "GET" },
  { name: "GET hash + expiresAt", url: `${CODEBUFF_API}/api/auth/cli/status?fingerprintHash=${FINGERPRINT_HASH}&expiresAt=${EXPIRES_AT}`, method: "GET" },
  { name: "GET auth_code", url: `${CODEBUFF_API}/api/auth/cli/status?auth_code=${AUTH_CODE}`, method: "GET" },
  { name: "GET all", url: `${CODEBUFF_API}/api/auth/cli/status?fingerprintId=&fingerprintHash=${FINGERPRINT_HASH}&expiresAt=${EXPIRES_AT}`, method: "GET" },
  { name: "POST hash", url: `${CODEBUFF_API}/api/auth/cli/status`, method: "POST", body: { fingerprintHash: FINGERPRINT_HASH } },
  { name: "POST all", url: `${CODEBUFF_API}/api/auth/cli/status`, method: "POST", body: { fingerprintHash: FINGERPRINT_HASH, expiresAt: Number(EXPIRES_AT) } },
  { name: "POST code", url: `${CODEBUFF_API}/api/auth/cli/status`, method: "POST", body: { authCode: AUTH_CODE } },
  { name: "POST confirm", url: `${CODEBUFF_API}/api/auth/cli/confirm`, method: "POST", body: { authCode: AUTH_CODE } },
  { name: "GET with cookie", url: `${CODEBUFF_API}/api/auth/cli/status?fingerprintHash=${FINGERPRINT_HASH}`, method: "GET", headers: { Cookie: `fingerprintHash=${FINGERPRINT_HASH}` } },
  { name: "GET freebuff status", url: `https://freebuff.com/api/auth/cli/status?fingerprintHash=${FINGERPRINT_HASH}`, method: "GET" },
  { name: "POST freebuff status", url: `https://freebuff.com/api/auth/cli/status`, method: "POST", body: { fingerprintHash: FINGERPRINT_HASH } },
];

async function tryTest(t) {
  const opts = {
    method: t.method,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json",
      ...t.headers,
    },
  };
  if (t.body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(t.body);
  }
  try {
    const res = await fetch(t.url, opts);
    const text = await res.text();
    return { name: t.name, status: res.status, body: text.slice(0, 500) };
  } catch (err) {
    return { name: t.name, status: "ERROR", body: err.message };
  }
}

console.log("=== PKCE ENDPOINT DISCOVERY ===\n");
for (const t of tests) {
  const r = await tryTest(t);
  const tag = r.status === 200 ? "✅" : (r.status === 401 ? "🔒" : (r.status === 404 ? "❌" : "❓"));
  console.log(`${tag} [${r.status}] ${r.name}`);
  if (r.body.trim()) {
    console.log(`     body: ${r.body.slice(0, 200)}`);
  }
}

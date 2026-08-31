#!/usr/bin/env node
/**
 * Discovery for /api/auth/cli/status parameter requirements.
 * Tries every combination of fingerprintId, fingerprintHash, expiresAt
 * with GET until we get a non-400 response (200 = success, 401 = needs auth, etc).
 */

const CODEBUFF_API = "https://www.codebuff.com";
const FINGERPRINT_HASH = "e0b2f2bec3168d4dcfdba31e7174a2bd6536c454991e62835cb880ed7e8b0ac5";
const EXPIRES_AT = "1784055823571";
const AUTH_CODE = "RkQFofvrPoHHQWqwciFrWg";

const fpId = "";
const fpIdNonEmpty = "enhanced-Crb4NKDS__h-NJIy5dk3IIMzG-LgIeuaF-oBS8SMCaE";

const combos = [
  { name: "hash+expires+id", params: { fingerprintHash: FINGERPRINT_HASH, expiresAt: EXPIRES_AT, fingerprintId: fpId } },
  { name: "hash+id", params: { fingerprintHash: FINGERPRINT_HASH, fingerprintId: fpId } },
  { name: "id+expires", params: { fingerprintId: fpId, expiresAt: EXPIRES_AT } },
  { name: "id only", params: { fingerprintId: fpId } },
  { name: "non-empty id+hash+expires", params: { fingerprintId: fpIdNonEmpty, fingerprintHash: FINGERPRINT_HASH, expiresAt: EXPIRES_AT } },
  { name: "expires+id", params: { expiresAt: EXPIRES_AT, fingerprintId: fpId } },
  { name: "expires+hash", params: { expiresAt: EXPIRES_AT, fingerprintHash: FINGERPRINT_HASH } },
  { name: "code+hash", params: { authCode: AUTH_CODE, fingerprintHash: FINGERPRINT_HASH } },
  { name: "code only", params: { authCode: AUTH_CODE } },
  { name: "expires+code", params: { expiresAt: EXPIRES_AT, authCode: AUTH_CODE } },
  { name: "id+code", params: { fingerprintId: fpId, authCode: AUTH_CODE } },
];

async function tryCombo(c) {
  const qs = new URLSearchParams(c.params).toString();
  const url = `${CODEBUFF_API}/api/auth/cli/status?${qs}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });
    const text = await res.text();
    return { name: c.name, url: url.substring(0, 100), status: res.status, body: text.slice(0, 200) };
  } catch (err) {
    return { name: c.name, url: url.substring(0, 100), status: "ERROR", body: err.message };
  }
}

console.log("=== Status Parameter Discovery ===\n");
for (const c of combos) {
  const r = await tryCombo(c);
  const tag = r.status === 200 ? "✅" : r.status === 401 ? "🔒" : r.status === 400 ? "❓" : "❌";
  console.log(`${tag} [${r.status}] ${r.name}`);
  console.log(`     ${r.url}`);
  if (r.body.trim()) console.log(`     ${r.body}`);
}

#!/usr/bin/env node
/**
 * PKCE cycle probe — test OAuth/API separation.
 *
 * Step 1: POST /api/auth/cli/code → get loginUrl + fingerprintHash + expiresAt
 * Step 2: Fetch freebuff.com/login?auth_code=... with browser-like headers
 *         to see what cookies/redirects the UI server emits
 *
 * Goal: determine whether freebuff.com sets cookies that codebuff.com later
 * relies on for auth, or if the entire handshake is just the auth_code +
 * fingerprint_id correlation.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const CODEBUFF_API = "https://www.codebuff.com";
const FREEBUFF_UI = "https://freebuff.com";

const credsPath = join(homedir(), ".config", "manicode", "credentials.json");
let creds = null;
if (existsSync(credsPath)) {
  try {
    const parsed = JSON.parse(readFileSync(credsPath, "utf8"));
    creds = parsed.default ?? parsed;
  } catch {}
}
if (!creds || !creds.email) {
  // Try fallback .fresh
  const fallback = join(homedir(), ".config", "manicode", "credentials.json.fresh");
  if (existsSync(fallback)) {
    try {
      const parsed = JSON.parse(readFileSync(fallback, "utf8"));
      creds = parsed.default ?? parsed;
    } catch {}
  }
}
if (!creds) {
  console.error("credentials.json not found and no fallback");
  process.exit(1);
}

console.log("[probe] === PKCE CYCLE PROBE ===");
console.log(`[probe] account: ${creds.email}`);
console.log(`[probe] fingerprintId: ${creds.fingerprintId}`);
console.log(`[probe] fingerprintHash: ${creds.fingerprintHash}`);

// ---------- Step 1: POST /api/auth/cli/code ----------
console.log("\n[probe] STEP 1: POST /api/auth/cli/code");

const codeResp = await fetch(`${CODEBUFF_API}/api/auth/cli/code`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "freebuff-test/1.0.0 node-fetch",
  },
  body: JSON.stringify({
    fingerprintId: creds.fingerprintId,
  }),
});

console.log(`[probe]   status: ${codeResp.status}`);
console.log(`[probe]   headers:`);
for (const [k, v] of codeResp.headers.entries()) {
  console.log(`[probe]     ${k}: ${v}`);
}
const setCookies = codeResp.headers.getSetCookie?.() ?? [];
if (setCookies.length) {
  console.log(`[probe]   set-cookie (parsed):`);
  for (const c of setCookies) console.log(`[probe]     ${c}`);
}
const codeBody = await codeResp.json();
console.log(`[probe]   body:`, JSON.stringify(codeBody, null, 2));

if (codeResp.status !== 200) {
  console.error("[probe] /api/auth/cli/code failed — abort");
  process.exit(1);
}

const { loginUrl, fingerprintHash, expiresAt } = codeBody;
console.log(`[probe]   loginUrl: ${loginUrl}`);
console.log(`[probe]   fingerprintHash: ${fingerprintHash}`);
console.log(`[probe]   expiresAt: ${expiresAt}`);

// ---------- Step 1.5: also fetch freebuff.com with the SAME auth_code ----------
console.log("\n[probe] STEP 1.5: GET freebuff.com/login?auth_code=... (same code)");

// Extract auth_code from the codebuff loginUrl
const authCodeMatch = loginUrl.match(/auth_code=([A-Za-z0-9_-]+)/);
if (authCodeMatch) {
  const authCode = authCodeMatch[1];
  const freebuffUrl = `https://freebuff.com/login?auth_code=${authCode}`;
  console.log(`[probe]   freebuff URL: ${freebuffUrl}`);

  const freeResp = await fetch(freebuffUrl, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
    },
  });

  console.log(`[probe]   status: ${freeResp.status}`);
  console.log(`[probe]   location: ${freeResp.headers.get("location")}`);
  console.log(`[probe]   headers:`);
  for (const [k, v] of freeResp.headers.entries()) {
    console.log(`[probe]     ${k}: ${v}`);
  }
  const freeSetCookies = freeResp.headers.getSetCookie?.() ?? [];
  if (freeSetCookies.length) {
    console.log(`[probe]   set-cookie (parsed):`);
    for (const c of freeSetCookies) console.log(`[probe]     ${c}`);
  }
  const freeContentType = freeResp.headers.get("content-type") ?? "";
  if (freeContentType.includes("text/html")) {
    const text = await freeResp.text();
    console.log(`[probe]   body (first 500 chars):\n${text.slice(0, 500)}`);
  } else {
    const text = await freeResp.text();
    console.log(`[probe]   body: ${text.slice(0, 300)}`);
  }
}

// ---------- Step 2: fetch the loginUrl returned by codebuff ----------
console.log("\n[probe] STEP 2: GET codebuff loginUrl");

const uiResp = await fetch(loginUrl, {
  method: "GET",
  redirect: "manual",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-User": "?1",
    "Sec-Fetch-Dest": "document",
  },
});

console.log(`[probe]   status: ${uiResp.status}`);
console.log(`[probe]   location (if redirect): ${uiResp.headers.get("location")}`);
console.log(`[probe]   headers:`);
for (const [k, v] of uiResp.headers.entries()) {
  console.log(`[probe]     ${k}: ${v}`);
}
const uiSetCookies = uiResp.headers.getSetCookie?.() ?? [];
if (uiSetCookies.length) {
  console.log(`[probe]   set-cookie (parsed):`);
  for (const c of uiSetCookies) console.log(`[probe]     ${c}`);
}
const contentType = uiResp.headers.get("content-type") ?? "";
let preview = "";
if (contentType.includes("text/html")) {
  const text = await uiResp.text();
  preview = text.slice(0, 500);
  console.log(`[probe]   body (first 500 chars):\n${preview}`);
} else {
  preview = await uiResp.text();
  console.log(`[probe]   body: ${preview.slice(0, 300)}`);
}

// ---------- Step 3: follow one redirect if any ----------
const loc = uiResp.headers.get("location");
if (loc) {
  console.log(`\n[probe] STEP 3: follow redirect → ${loc}`);
  const redResp = await fetch(loc, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });
  console.log(`[probe]   status: ${redResp.status}`);
  console.log(`[probe]   location: ${redResp.headers.get("location")}`);
  console.log(`[probe]   headers:`);
  for (const [k, v] of redResp.headers.entries()) {
    console.log(`[probe]     ${k}: ${v}`);
  }
  const redSetCookies = redResp.headers.getSetCookie?.() ?? [];
  if (redSetCookies.length) {
    console.log(`[probe]   set-cookie (parsed):`);
    for (const c of redSetCookies) console.log(`[probe]     ${c}`);
  }
}

console.log("\n[probe] === END ===");
console.log("[probe] NOTE: Don't forget to poll /api/auth/cli/status from another");
console.log("[probe]       process to actually capture the token exchange.");
console.log("[probe]       Quick command:");
console.log(
  `[probe]         curl "${CODEBUFF_API}/api/auth/cli/status?fingerprintId=${creds.fingerprintId}&fingerprintHash=${fingerprintHash}&expiresAt=${expiresAt}"`,
);

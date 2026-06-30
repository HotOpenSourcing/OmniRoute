// scripts/repro-kimchi-503.mjs
// Reproduce the streaming 503 from Kimchi by calling the upstream exactly the way
// Omni would: load the Kimchi provider entry, build headers via the default executor's
// buildHeaders(), and stream a request. Compare to a direct curl with the same headers.

import { kimchiProvider } from "../open-sse/config/providers/registry/kimchi/index.ts";
import { getExecutor } from "../open-sse/executors/index.ts";
import fs from "node:fs";

function loadApiKey() {
  if (process.env.KIMCHI_API_KEY) return process.env.KIMCHI_API_KEY.trim();
  for (const path of [
    "/mnt/c/Users/amine/.kimchi/kimchi-key.txt",
    "C:/Users/amine/.kimchi/kimchi-key.txt",
  ]) {
    try {
      const raw = fs.readFileSync(path, "utf8");
      const first = raw.split("\n").map((l) => l.trim()).filter(Boolean)[0];
      if (first) return first;
    } catch {}
  }
  return null;
}

const apiKey = loadApiKey();
if (!apiKey) {
  console.error("No API key available");
  process.exit(1);
}

console.log("Loaded Kimchi provider:");
console.log("  id:", kimchiProvider.id);
console.log("  baseUrl:", kimchiProvider.baseUrl);
console.log("  preserveStainlessHeaders:", kimchiProvider.preserveStainlessHeaders);
console.log("  pre-set headers count:", Object.keys(kimchiProvider.headers || {}).length);
console.log("  api key (first 20):", apiKey.slice(0, 20));

const executor = getExecutor(kimchiProvider.id, {
  id: kimchiProvider.id,
  baseUrl: kimchiProvider.baseUrl,
  headers: kimchiProvider.headers,
  preserveStainlessHeaders: kimchiProvider.preserveStainlessHeaders,
  timeoutMs: kimchiProvider.timeoutMs,
});

console.log("\nExecutor class:", executor.constructor.name);
console.log("Executor.config.headers keys:", Object.keys(executor.config.headers || {}));
console.log("Executor.config.preserveStainlessHeaders:", executor.config.preserveStainlessHeaders);

const model = "minimax-m3";
const body = {
  model,
  max_tokens: 60,
  temperature: 0.2,
  reasoning_effort: "low",
  stream: true,
  messages: [{ role: "user", content: "Compte de 1 à 3." }],
};

console.log("\n─── buildHeaders(stream=true) ───");
const headers = executor.buildHeaders({ apiKey }, true, {});
console.log("Built headers:");
for (const [k, v] of Object.entries(headers)) {
  console.log(`  ${k}: ${v}`);
}

console.log("\n─── buildUrl(stream=true) ───");
const url = executor.buildUrl(model, true, 0, { apiKey });
console.log("URL:", url);

console.log("\n─── Fetch upstream with Omni-built headers ───");
const t0 = Date.now();
try {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  console.log(`HTTP ${res.status}  ${ms}ms`);
  console.log("content-type:", res.headers.get("content-type"));

  const text = await res.text();
  console.log("body:", text.slice(0, 800));
} catch (err) {
  console.log("error:", err.message);
}

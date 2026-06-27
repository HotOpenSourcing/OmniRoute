// scripts/test-kimchi-provider.mjs
// Verifies that the Kimchi provider is correctly registered in the
// open-sse provider registry, and tests live chat completions against
// llm.kimchi.dev for all 5 models + streaming SSE, with the Stainless
// headers required by the Cast AI router.

import { kimchiProvider, getKimchiHeaders } from "../open-sse/config/providers/registry/kimchi/index.ts";
import { REGISTRY as providerRegistry } from "../open-sse/config/providers/index.ts";

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else { console.log(`  ✗ ${label}`); fail++; }
}

console.log("─── 1. Provider metadata ───");
check("kimchi id = 'kimchi'", kimchiProvider.id === "kimchi");
check("alias = 'kimchi'", kimchiProvider.alias === "kimchi");
check("format = 'openai'", kimchiProvider.format === "openai");
check("authType = 'apikey'", kimchiProvider.authType === "apikey");
check("authHeader = 'bearer'", kimchiProvider.authHeader === "bearer");
check("baseUrl points to llm.kimchi.dev",
  kimchiProvider.baseUrl === "https://llm.kimchi.dev/openai/v1/chat/completions");
check("passthroughModels = true", kimchiProvider.passthroughModels === true);
check("has 5 models", kimchiProvider.models.length === 5);

const expectedModels = ["minimax-m3", "kimi-k2.7", "glm-5.2-fp8",
                        "deepseek-v4-flash", "nemotron-3-ultra-fp4"];
for (const m of expectedModels) {
  check(`model '${m}' present`, kimchiProvider.models.some(x => x.id === m));
}

console.log("\n─── 2. Stainless headers ───");
const headers = getKimchiHeaders();
check("user-agent = 'kimchi/0.1.50'", headers["user-agent"] === "kimchi/0.1.50");
check("x-stainless-package-version = '6.26.0'",
  headers["x-stainless-package-version"] === "6.26.0");
check("x-stainless-runtime = 'node'", headers["x-stainless-runtime"] === "node");
check("x-stainless-lang = 'js'", headers["x-stainless-lang"] === "js");
check("x-stainless-timeout = '300'", headers["x-stainless-timeout"] === "300");
check("x-stainless-retry-count = '0'", headers["x-stainless-retry-count"] === "0");
check("x-stainless-runtime-version present", typeof headers["x-stainless-runtime-version"] === "string" && headers["x-stainless-runtime-version"].length > 0);
check("x-stainless-arch present", typeof headers["x-stainless-arch"] === "string");
check("x-stainless-os present", typeof headers["x-stainless-os"] === "string");

console.log("\n─── 3. Registry integration ───");
check("providerRegistry.kimchi exists", !!providerRegistry.kimchi);
check("providerRegistry.kimchi === kimchiProvider",
  providerRegistry.kimchi === kimchiProvider);
check("providerRegistry.agentrouter still present", !!providerRegistry.agentrouter);

const fs = await import("node:fs");
let apiKey = process.env.KIMCHI_API_KEY;
if (!apiKey) {
  for (const p of [
    "C:/Users/amine/.kimchi/kimchi-key.txt",
    "/mnt/c/Users/amine/.kimchi/kimchi-key.txt",
    "/tmp/kimchi-key.txt",
  ]) {
    try { apiKey = fs.readFileSync(p, "utf8").trim(); if (apiKey) { console.log(`  loaded key from ${p}`); break; } } catch {}
  }
}

if (!apiKey) {
  console.log("\n─── 4/5/6 skipped ───");
  console.log("  ⚠ KIMCHI_API_KEY env var not set and no key file found — skipping live tests");
} else {
  console.log(`\n─── 4. Live chat completions: all 5 models ───`);
  console.log(`  using API key: ${apiKey.slice(0, 20)}…`);

  for (const modelId of expectedModels) {
    console.log(`\n  [model: ${modelId}]`);
    const t0 = Date.now();
    try {
      const res = await fetch(kimchiProvider.baseUrl, {
        method: "POST",
        headers: {
          ...headers,
          "authorization": `Bearer ${apiKey}`,
          "content-type": "application/json",
          "accept": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: 60,
          temperature: 0.2,
          reasoning_effort: "low",
          messages: [{ role: "user", content: "Dis bonjour en français." }],
        }),
      });
      const ms = Date.now() - t0;
      const text = await res.text();
      let j;
      try { j = JSON.parse(text); } catch { j = null; }
      console.log(`    HTTP ${res.status}  ${ms}ms`);
      check(`${modelId} HTTP 200`, res.status === 200);
      if (j) {
        const content = j?.choices?.[0]?.message?.content || "";
        const usage = j?.usage || {};
        console.log(`    model:    ${j.model}`);
        console.log(`    content:  ${JSON.stringify(content)}`);
        console.log(`    usage:    total=${usage.total_tokens}`);
        check(`${modelId} has choices`, Array.isArray(j.choices));
        check(`${modelId} content non-empty`, content.length > 0);
        check(`${modelId} model echoed`, j.model === modelId);
      } else {
        console.log(`    raw body: ${text.slice(0, 200)}`);
        fail++;
      }
    } catch (err) {
      console.log(`    ✗ ${modelId} network error: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n─── 5. Streaming SSE test ───`);
  const streamModel = "minimax-m3";
  console.log(`  [model: ${streamModel}, stream=true]`);
  const t0 = Date.now();
  try {
    const res = await fetch(kimchiProvider.baseUrl, {
      method: "POST",
      headers: {
        ...headers,
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
        "accept": "text/event-stream",
      },
      body: JSON.stringify({
        model: streamModel,
        max_tokens: 60,
        temperature: 0.2,
        reasoning_effort: "low",
        stream: true,
        messages: [{ role: "user", content: "Compte de 1 à 3." }],
      }),
    });
    const ms = Date.now() - t0;
    console.log(`  HTTP ${res.status}  ${ms}ms`);
    check("streaming HTTP 200", res.status === 200);
    check("streaming content-type is event-stream",
      (res.headers.get("content-type") || "").includes("text/event-stream"));

    const body = await res.text();
    const lines = body.split("\n").filter(l => l.startsWith("data:"));
    console.log(`  received ${lines.length} SSE data lines`);
    check("at least 2 SSE data lines", lines.length >= 2);

    let fullContent = "";
    let gotDone = false;
    for (const line of lines) {
      const payload = line.replace(/^data:\s*/, "").trim();
      if (payload === "[DONE]") { gotDone = true; break; }
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk?.choices?.[0]?.delta?.content || "";
        if (delta) fullContent += delta;
      } catch {}
    }
    console.log(`  streamed content: ${JSON.stringify(fullContent)}`);
    check("streaming has content", fullContent.length > 0);
    check("streaming got [DONE]", gotDone);
  } catch (err) {
    console.log(`  ✗ streaming error: ${err.message}`);
    fail += 4;
  }
}

console.log(`\n─── Result ───`);
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

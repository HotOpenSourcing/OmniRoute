// Probe ALL possible endpoints for zai-coding-plan (masked endpoint search)
const CODE = "code-ff102b4e10dd";
const H = { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
const H_OPENAI = { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json" };

const ENDPOINTS = [];

// ─── Origins ─────────
const origins = ["https://zcode.z.ai", "https://api.z.ai", "https://chat.z.ai", "https://zhipu.ai", "https://open.bigmodel.cn"];

// ─── Path patterns ────
const paths = {
  anthropic: ["/api/v1/zcode-plan/anthropic", "/api/anthropic", "/api/v1/anthropic", "/v1/anthropic"],
  openai: ["/api/v1/zcode-plan/openai", "/api/openai", "/api/v1/openai", "/v1/openai"],
  paas: ["/api/coding/paas/v4", "/api/v1/coding/paas", "/api/paas/v4"],
  custom: ["/api/v1/zcode-plan", "/api/zcode-plan", "/zcode-plan"],
};

// ─── Build all endpoint combos ────
for (const origin of origins) {
  for (const [protocol, pList] of Object.entries(paths)) {
    for (const p of pList) {
      ENDPOINTS.push({ label: `${origin}${p} (${protocol})`, origin, path: p, protocol });
    }
  }
}

console.log(`Testing ${ENDPOINTS.length} endpoint combinations...\n`);

// ─── Phase 1: Quick probe (HEAD/GET on /models + POST /messages) ──────
async function probe() {
  for (const ep of ENDPOINTS) {
    // Try POST /v1/messages (Anthropic) or POST /v1/chat/completions (OpenAI)
    const chatPath = ep.protocol === "openai" ? "/v1/chat/completions" : "/v1/messages";
    const h = ep.protocol === "openai" ? H_OPENAI : H;
    const body = ep.protocol === "openai"
      ? JSON.stringify({ model: "glm-5.2", max_tokens: 16, messages: [{ role: "user", content: "hi" }] })
      : JSON.stringify({ model: "glm-5.2", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });

    try {
      const res = await fetch(`${ep.origin}${ep.path}${chatPath}`, {
        method: "POST",
        headers: h,
        body,
      });
      if (res.status === 404) continue; // silent skip
      const text = await res.text();
      const tag = res.ok ? "✅" : `❌${res.status}`;
      console.log(`[${tag}] POST ${ep.origin}${ep.path}${chatPath}`);
      if (res.ok) {
        try { const d = JSON.parse(text); console.log("   content:", d?.content?.[0]?.text || d?.choices?.[0]?.message?.content || JSON.stringify(d).slice(0,200)); } catch { console.log("   raw:", text.slice(0, 200)); }
      } else {
        console.log("   ", text.slice(0, 200));
      }
    } catch (e) { /* ignore network errors */ }
  }

  // ─── Phase 2: Token exchange variants ──────────────────────────────────
  console.log("\n=== Token exchange deep probe ===");
  const tokenUrls = [
    "https://zcode.z.ai/api/v1/oauth/token",
    "https://zcode.z.ai/api/v1/oauth/cli/init",
    "https://chat.z.ai/api/oauth/token",
    "https://api.z.ai/api/auth/z/login",
  ];
  
  for (const url of tokenUrls) {
    // try JSON body with code
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: CODE }) });
      const tag = res.ok ? "✅" : `❌${res.status}`;
      console.log(`[${tag}] POST ${url} {code}`);
      if (res.ok) console.log("   ", (await res.text()).slice(0, 400));
      else { const t = await res.text(); if (t && !t.includes("404")) console.log("   ", t.slice(0, 200)); }
    } catch (e) { /* ignore */ }
    
    // Try init format
    if (url.includes("/cli/init")) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${CODE}` }, body: JSON.stringify({ provider: "zai" }) });
        const tag = res.ok ? "✅" : `❌${res.status}`;
        console.log(`[${tag}] POST ${url} {provider:zai} Bearer`);
        if (res.ok) console.log("   ", (await res.text()).slice(0, 400));
        else { const t = await res.text(); if (t && !t.includes("404")) console.log("   ", t.slice(0, 200)); }
      } catch (e) { /* ignore */ }
    }

    // Try tokenUrl with refresh format
    if (url.includes("/token")) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token", refresh_token: CODE, client_id: "client_P8X5CMWmlaRO9gyO-KSqtg" }) });
        const tag = res.ok ? "✅" : `❌${res.status}`;
        console.log(`[${tag}] POST ${url} {refresh_token}`);
        if (res.ok) console.log("   ", (await res.text()).slice(0, 400));
        else { const t = await res.text(); if (t && !t.includes("404")) console.log("   ", t.slice(0, 200)); }
      } catch (e) { /* ignore */ }
    }
  }
  
  console.log("\n=== DONE ===");
}

probe().catch(e => console.error("FATAL:", e.message));

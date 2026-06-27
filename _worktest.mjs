// Focus on the 2 working endpoints + probe env vars
const CODE = "code-ff102b4e10dd";

const H_A = { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
const H_O = { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json" };

async function test() {
  // 1. Anthropic endpoint that WORKS
  console.log("=== 1. Anthropic endpoint (confirmed working) ===");
  const chatRes = await fetch("https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages", {
    method: "POST",
    headers: H_A,
    body: JSON.stringify({
      model: "glm-5.2",
      max_tokens: 64,
      messages: [{ role: "user", content: "say PONG" }],
    }),
  });
  const chatText = await chatRes.text();
  console.log(`HTTP ${chatRes.status}`);
  console.log("Response:", chatText.slice(0, 1000));

  // 2. GET /models 
  console.log("\n=== 2. GET /v1/models ===");
  const modelsRes = await fetch("https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/models", { method: "GET", headers: H_A });
  const modelsText = await modelsRes.text();
  console.log(`HTTP ${modelsRes.status}`);
  if (modelsRes.ok) console.log("Models:", modelsText.slice(0, 2000));
  else console.log("Body:", modelsText.slice(0, 300));

  // 3. Try env var 'zcodePlanOpenAiBaseUrl' as env override
  console.log("\n=== 3. OpenAI-compatible endpoint (env var hinted) ===");
  const openaiEndpoints = [
    "https://zcode.z.ai/api/v1/zcode-plan/openai/v1/chat/completions",
    "https://zcode.z.ai/api/v1/zcode-plan/openai/v1/models",
  ];
  for (const url of openaiEndpoints) {
    const method = url.includes("/models") ? "GET" : "POST";
    const body = method === "POST" ? JSON.stringify({ model: "glm-5.2", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }) : undefined;
    const res = await fetch(url, { method, headers: method === "POST" ? H_O : H_O, body });
    if (res.status === 404) continue;
    const text = await res.text();
    const tag = res.ok ? "✅" : `❌${res.status}`;
    console.log(`${tag} ${method} ${url}`);
    console.log("  ", text.slice(0, 500));
  }

  // 4. Try paas/v4 models (P4e hinted endpoint)
  console.log("\n=== 4. PaaS v4 endpoints ===");
  const paasUrls = [
    "https://api.z.ai/api/coding/paas/v4",
    "https://api.z.ai/api/coding/paas/v4/models",
    "https://api.z.ai/api/coding/paas/v4/v1/models",
  ];
  for (const url of paasUrls) {
    const res = await fetch(url, { method: "GET", headers: H_A });
    if (res.status === 404) continue;
    const text = await res.text();
    const tag = res.ok ? "✅" : `❌${res.status}`;
    console.log(`${tag} GET ${url}`);
    console.log("  ", text.slice(0, 1000));
  }

  console.log("\n=== DONE ===");
}

test().catch(e => console.error("FATAL:", e.message));

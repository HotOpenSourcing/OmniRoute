// Test chat.z.ai as origin for zcode-plan endpoint
const CODE = "code-ff102b4e10dd";

const ORIGINS = [
  "https://chat.z.ai",
  "https://api.z.ai",
  "https://zcode.z.ai",
  "https://open.bigmodel.cn",
  "https://auth.z.ai",
];

const H = { Authorization: `Bearer ${CODE}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" };

async function test() {
  for (const origin of ORIGINS) {
    const paths = [
      `${origin}/api/v1/zcode-plan/anthropic/v1/messages`,
      `${origin}/api/v1/zcode-plan/anthropic/messages`,
      `${origin}/api/anthropic/v1/messages`,
      `${origin}/api/v1/anthropic/v1/messages`,
      `${origin}/v1/messages`,
      `${origin}/api/chat/v1/messages`,
      // OpenAI compatible
      `${origin}/api/v1/zcode-plan/openai/v1/chat/completions`,
      `${origin}/api/v1/zcode-plan/openai/chat/completions`,
      `${origin}/v1/chat/completions`,
    ];
    
    for (const url of paths) {
      try {
        const res = await fetch(url, { method: "POST", headers: H, body: JSON.stringify({ model: "glm-5.2", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }) });
        if (res.status === 404) continue;
        const text = await res.text();
        const tag = res.ok ? "✅" : `❌${res.status}`;
        console.log(`${tag} POST ${url}`);
        if (res.ok) console.log("   ", text.slice(0, 300));
        else console.log("   ", text.slice(0, 150));
      } catch (e) { /* network error */ }
    }
  }

  // Also try GET /models on api.z.ai (P4e base)
  console.log("\n=== Models endpoints ===");
  const modelPaths = [
    "https://api.z.ai/api/coding/paas/v4/models",
    "https://api.z.ai/api/coding/paas/v4/v1/models",
    "https://api.z.ai/api/coding/paas/v4/model/list",
    "https://api.z.ai/v1/models",
    "https://api.z.ai/api/anthropic/v1/models",
    "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/models",
  ];
  for (const url of modelPaths) {
    try {
      const res = await fetch(url, { method: "GET", headers: H });
      if (res.status === 404) continue;
      const text = await res.text();
      const tag = res.ok ? "✅" : `❌${res.status}`;
      console.log(`${tag} GET ${url}`);
      if (res.ok) console.log("   ", text.slice(0, 500));
      else console.log("   ", text.slice(0, 150));
    } catch (e) { /* ignore */ }
  }

  console.log("\n=== DONE ===");
}

test().catch(e => console.error(e.message));

#!/usr/bin/env node
/**
 * Test avec Playwright - version corrigée
 */

import { chromium } from "playwright";

const TOKEN = "136313a5-13af-4326-8c42-227ad63351b4";
const BASE_URL = "https://www.codebuff.com";

async function main() {
  console.log("🌐 Test Playwright (vrai navigateur)\n");
  console.log("=".repeat(60) + "\n");

  console.log("Lancement du navigateur...");
  const browser = await chromium.launch({
    headless: true,
  });

  console.log("✅ Navigateur lancé");

  const page = await browser.newPage({
    userAgent: "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser",
    ignoreHTTPSErrors: true,
  });

  console.log("✅ Page créée\n");

  try {
    // Étape 1: Session
    console.log("📍 Étape 1: Création session...\n");

    const session = await page.evaluate(async ({ url, token }) => {
      const res = await fetch(`${url}/api/v1/freebuff/session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          device: { os: "windows", timezone: "Africa/Tunis", locale: "fr-FR" },
        }),
      });
      return { status: res.status, data: await res.json() };
    }, { url: BASE_URL, token: TOKEN });

    console.log(`Status: ${session.status}`);
    console.log(JSON.stringify(session.data, null, 2));
    console.log();

    if (session.status !== 200) {
      await browser.close();
      process.exit(1);
    }

    const instanceId = session.data.instanceId;

    // Étape 2: Agent run
    console.log("📍 Étape 2: Création agent run...\n");

    const run = await page.evaluate(async ({ url, token }) => {
      const res = await fetch(`${url}/api/v1/agent-runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "START",
          agentId: "base2-free-deepseek-flash",
          ancestorRunIds: [],
        }),
      });
      return { status: res.status, data: await res.json() };
    }, { url: BASE_URL, token: TOKEN });

    console.log(`Status: ${run.status}`);
    console.log(JSON.stringify(run.data, null, 2));
    console.log();

    if (run.status !== 200) {
      await browser.close();
      process.exit(1);
    }

    const runId = run.data.runId;
    console.log(`🔑 Run ID: ${runId}\n`);

    // Étape 3: Chat completion
    console.log("📍 Étape 3: Chat completion...\n");

    const chat = await page.evaluate(
      async ({ url, token, runId, instanceId }) => {
        const body = {
          model: "deepseek/deepseek-v4-flash",
          stop: ['"cb_easp"'],
          codebuff_metadata: {
            freebuff_instance_id: instanceId,
            trace_session_id: crypto.randomUUID(),
            run_id: runId,
            client_id: "4utb3yxkau",
            cost_mode: "free",
          },
          provider: { data_collection: "deny" },
          messages: [{ role: "user", content: "Say 'PLAYWRIGHT SUCCESS!'" }],
          stream: true,
        };

        const res = await fetch(`${url}/api/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          return { status: res.status, error: await res.text() };
        }

        // Lire stream
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) text += content;
              } catch {}
            }
          }
        }

        return { status: res.status, text };
      },
      { url: BASE_URL, token: TOKEN, runId, instanceId }
    );

    console.log(`Status: ${chat.status}\n`);

    if (chat.error) {
      console.error("❌ Erreur:", chat.error);
      await browser.close();
      process.exit(1);
    }

    console.log("✅✅✅ SUCCÈS COMPLET ✅✅✅\n");
    console.log("📄 Réponse:");
    console.log(chat.text);
    console.log("\n" + "=".repeat(60));

    await browser.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    await browser.close();
    process.exit(1);
  }
}

main();

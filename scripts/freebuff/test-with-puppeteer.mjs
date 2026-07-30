#!/usr/bin/env node
/**
 * Test avec Puppeteer pour utiliser le vrai TLS fingerprint du navigateur
 */

import puppeteer from "puppeteer";

const TOKEN = "136313a5-13af-4326-8c42-227ad63351b4";
const BASE_URL = "https://www.codebuff.com";

async function testWithPuppeteer() {
  console.log("🌐 Utilisation de Puppeteer (vrai navigateur)\n");
  console.log("=" .repeat(60) + "\n");

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    
    // Set User-Agent
    await page.setUserAgent(
      "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser"
    );

    // Étape 1: Créer la session Freebuff
    console.log("📍 Étape 1: Création de la session Freebuff...\n");

    const sessionResponse = await page.evaluate(
      async ({ baseUrl, token }) => {
        const response = await fetch(`${baseUrl}/api/v1/freebuff/session`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            device: {
              os: "windows",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              locale: navigator.language,
            },
          }),
        });

        return {
          status: response.status,
          statusText: response.statusText,
          data: await response.json(),
        };
      },
      { baseUrl: BASE_URL, token: TOKEN }
    );

    console.log(`Status: ${sessionResponse.status} ${sessionResponse.statusText}`);
    console.log("Session data:");
    console.log(JSON.stringify(sessionResponse.data, null, 2));
    console.log();

    if (sessionResponse.status !== 200) {
      console.error("❌ Échec de la création de session");
      await browser.close();
      process.exit(1);
    }

    const instanceId = sessionResponse.data.instanceId;

    // Étape 2: Créer l'agent run
    console.log("📍 Étape 2: Création de l'agent run...\n");

    const runResponse = await page.evaluate(
      async ({ baseUrl, token }) => {
        const response = await fetch(`${baseUrl}/api/v1/agent-runs`, {
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

        return {
          status: response.status,
          statusText: response.statusText,
          data: await response.json(),
        };
      },
      { baseUrl: BASE_URL, token: TOKEN }
    );

    console.log(`Status: ${runResponse.status} ${runResponse.statusText}`);
    console.log("Run data:");
    console.log(JSON.stringify(runResponse.data, null, 2));
    console.log();

    if (runResponse.status !== 200) {
      console.error("❌ Échec de la création du run");
      await browser.close();
      process.exit(1);
    }

    const runId = runResponse.data.runId;
    console.log(`🔑 Run ID obtenu: ${runId}\n`);

    // Étape 3: Envoyer le chat completion
    console.log("📍 Étape 3: Envoi du chat completion...\n");

    const chatResponse = await page.evaluate(
      async ({ baseUrl, token, runId, instanceId, clientId }) => {
        const traceSessionId = crypto.randomUUID();

        const body = {
          model: "deepseek/deepseek-v4-flash",
          stop: ['"cb_easp"'],
          codebuff_metadata: {
            freebuff_instance_id: instanceId,
            trace_session_id: traceSessionId,
            run_id: runId,
            client_id: clientId,
            cost_mode: "free",
          },
          provider: {
            data_collection: "deny",
          },
          messages: [
            {
              role: "user",
              content: "Say 'PUPPETEER SUCCESS' if you can read this!",
            },
          ],
          stream: true,
        };

        console.log("Metadata:");
        console.log(JSON.stringify(body.codebuff_metadata, null, 2));

        const response = await fetch(`${baseUrl}/api/v1/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        const status = response.status;
        const statusText = response.statusText;

        if (!response.ok) {
          const errorText = await response.text();
          return {
            status,
            statusText,
            error: errorText,
          };
        }

        // Lire le stream SSE
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  fullResponse += content;
                }
              } catch (e) {
                // Ignore
              }
            }
          }
        }

        return {
          status,
          statusText,
          response: fullResponse,
        };
      },
      {
        baseUrl: BASE_URL,
        token: TOKEN,
        runId,
        instanceId,
        clientId: "4utb3yxkau",
      }
    );

    console.log(`Status: ${chatResponse.status} ${chatResponse.statusText}\n`);

    if (chatResponse.error) {
      console.error("❌ Erreur:");
      console.error(chatResponse.error);
      await browser.close();
      process.exit(1);
    }

    console.log("✅ SUCCÈS!\n");
    console.log("📄 Réponse du modèle:\n");
    console.log(chatResponse.response);
    console.log();

    await browser.close();

    console.log("\n" + "=".repeat(60));
    console.log("\n✅✅✅ SUCCÈS COMPLET AVEC PUPPETEER ✅✅✅");
    console.log("=".repeat(60));

    process.exit(0);
  } catch (error) {
    console.error("❌ Exception:", error.message);
    console.error(error.stack);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

testWithPuppeteer();

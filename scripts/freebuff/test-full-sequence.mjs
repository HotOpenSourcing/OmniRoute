#!/usr/bin/env node
/**
 * Reproduit la SÉQUENCE COMPLÈTE du CLI Freebuff :
 * 1. POST /api/v1/freebuff/session
 * 2. POST /api/v1/agent-runs
 * 3. POST /api/v1/chat/completions (avec le run_id obtenu)
 */

import { randomUUID } from "crypto";

// Configuration
const TOKEN = "136313a5-13af-4326-8c42-227ad63351b4";
const BASE_URL = "https://www.codebuff.com";
const USER_AGENT = "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser";
const CLIENT_ID = "4utb3yxkau";

/**
 * Étape 1: Créer une session Freebuff
 */
async function createFreebuffSession() {
  console.log("📍 Étape 1: Création de la session Freebuff...\n");

  const body = {
    // Basé sur les patterns observés dans le CLI
    device: {
      os: "windows",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: "fr-FR",
    },
  };

  try {
    const response = await fetch(`${BASE_URL}/api/v1/freebuff/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:", errorText);
      return null;
    }

    const data = await response.json();
    console.log("✅ Session créée:");
    console.log(JSON.stringify(data, null, 2));
    console.log();

    return data;
  } catch (error) {
    console.error("❌ Exception:", error.message);
    return null;
  }
}

/**
 * Étape 2: Créer un agent run
 */
async function createAgentRun(sessionData) {
  console.log("📍 Étape 2: Création de l'agent run...\n");

  // Format EXACT extrait de la capture mitmproxy
  const body = {
    action: "START",
    agentId: "base2-free-deepseek-flash",
    ancestorRunIds: [],
  };

  try {
    const response = await fetch(`${BASE_URL}/api/v1/agent-runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify(body),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:", errorText);
      return null;
    }

    const data = await response.json();
    console.log("✅ Agent run créé:");
    console.log(JSON.stringify(data, null, 2));
    console.log();

    return data;
  } catch (error) {
    console.error("❌ Exception:", error.message);
    return null;
  }
}

/**
 * Étape 3: Envoyer le chat completion avec le run_id valide
 */
async function sendChatCompletion(runId, traceSessionId, freebuffInstanceId) {
  console.log("📍 Étape 3: Envoi du chat completion...\n");

  const body = {
    model: "deepseek/deepseek-v4-flash",
    stop: ['"cb_easp"'],
    codebuff_metadata: {
      freebuff_instance_id: freebuffInstanceId || randomUUID(),
      trace_session_id: traceSessionId || randomUUID(),
      run_id: runId, // 🎯 Le run_id obtenu de l'API
      client_id: CLIENT_ID,
      cost_mode: "free",
    },
    provider: {
      data_collection: "deny",
    },
    messages: [
      {
        role: "user",
        content: "Say 'FULL SEQUENCE SUCCESS' if you can read this message!",
      },
    ],
    stream: true,
  };

  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    Connection: "keep-alive",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };

  console.log("Metadata utilisées:");
  console.log(JSON.stringify(body.codebuff_metadata, null, 2));
  console.log();

  try {
    const response = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    console.log(`Status: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:", errorText);
      return false;
    }

    console.log("✅ SUCCÈS! Stream reçu!\n");
    console.log("📄 Réponse du modèle:\n");

    // Traiter le stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalChunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            console.log("\n\n✅ Stream terminé");
            console.log(`📊 Total chunks: ${totalChunks}`);
            continue;
          }

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
              totalChunks++;
            }
          } catch (e) {
            // Ignore
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Exception:", error.message);
    return false;
  }
}

/**
 * Main: Exécuter la séquence complète
 */
async function main() {
  console.log("🚀 SÉQUENCE COMPLÈTE DU FLOW FREEBUFF CLI\n");
  console.log("=" .repeat(60) + "\n");

  // Étape 1: Session
  const sessionData = await createFreebuffSession();
  if (!sessionData) {
    console.error("\n❌ Échec à l'étape 1 (session)");
    process.exit(1);
  }

  // Étape 2: Agent Run
  const runData = await createAgentRun(sessionData);
  if (!runData) {
    console.error("\n❌ Échec à l'étape 2 (agent run)");
    process.exit(1);
  }

  // Extraire les IDs nécessaires
  const runId = runData.runId || runData.id || runData.run_id;
  const traceSessionId = runData.traceSessionId || runData.trace_session_id;
  const freebuffInstanceId = sessionData.instanceId || sessionData.instance_id;

  if (!runId) {
    console.error("\n❌ Pas de runId retourné par l'API!");
    console.log("Données reçues:", runData);
    process.exit(1);
  }

  console.log(`🔑 Run ID obtenu: ${runId}\n`);

  // Étape 3: Chat Completion
  const success = await sendChatCompletion(runId, traceSessionId, freebuffInstanceId);

  console.log("\n" + "=".repeat(60));
  console.log(success ? "\n✅ SUCCÈS COMPLET!" : "\n❌ Échec à l'étape 3");
  console.log("=" .repeat(60));

  process.exit(success ? 0 : 1);
}

main();

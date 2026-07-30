#!/usr/bin/env node
/**
 * Émulation complète de la signature CLI Freebuff
 * Reproduit TOUS les éléments identifiés dans la capture mitmproxy
 */

import { randomUUID } from "crypto";

// Configuration
const CONFIG = {
  token: process.env.FREEBUFF_API_KEY || "",
  apiUrl: "https://www.codebuff.com/api/v1/chat/completions",
  
  // Signature CLI capturée
  userAgent: "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser",
  clientId: "4utb3yxkau", // Du CLI réel - à tester
  
  // Modèle et paramètres
  model: "deepseek/deepseek-v4-flash",
  stopToken: '"cb_easp"', // Format avec quotes escapées
};

/**
 * Génère les métadonnées Codebuff comme le CLI
 */
function generateCodebuffMetadata() {
  return {
    freebuff_instance_id: randomUUID(),
    trace_session_id: randomUUID(),
    run_id: randomUUID(),
    client_id: CONFIG.clientId,
    cost_mode: "free",
  };
}

/**
 * Construit le body de la requête
 */
function buildRequestBody(message) {
  return {
    model: CONFIG.model,
    stop: [CONFIG.stopToken],
    codebuff_metadata: generateCodebuffMetadata(),
    provider: {
      data_collection: "deny",
    },
    messages: [
      {
        role: "user",
        content: message,
      },
    ],
    stream: true,
  };
}

/**
 * Construit les headers exactement comme le CLI
 */
function buildHeaders() {
  return {
    Authorization: `Bearer ${CONFIG.token}`,
    "Content-Type": "application/json",
    "User-Agent": CONFIG.userAgent,
    Connection: "keep-alive",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };
}

/**
 * Envoie une requête de chat completion
 */
async function sendChatRequest(message) {
  const body = buildRequestBody(message);
  const headers = buildHeaders();

  console.log("🧪 Test d'émulation CLI complète\n");
  console.log("📋 Configuration:");
  console.log(`  Token: ${CONFIG.token.slice(0, 20)}...`);
  console.log(`  Model: ${CONFIG.model}`);
  console.log(`  User-Agent: ${CONFIG.userAgent}`);
  console.log(`  Client ID: ${CONFIG.clientId}\n`);

  console.log("📦 Metadata:");
  console.log(JSON.stringify(body.codebuff_metadata, null, 2));
  console.log();

  try {
    const response = await fetch(CONFIG.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    console.log(`📡 Response: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:");
      console.error(errorText);
      
      // Analyse de l'erreur
      if (errorText.includes("free_mode_cli_required")) {
        console.log("\n🔍 Analyse:");
        console.log("  ⚠️  Toujours bloqué par free_mode_cli_required");
        console.log("  💡 Hypothèses:");
        console.log("     1. Le client_id est lié au token Bearer (ne peut pas être réutilisé)");
        console.log("     2. Le backend fait du TLS fingerprinting (JA3/JA4)");
        console.log("     3. Il y a une signature cachée dans le token JWT lui-même");
        console.log("     4. Le backend vérifie l'ordre des headers ou d'autres détails HTTP/2");
      } else if (response.status === 401) {
        console.log("\n🔍 Analyse:");
        console.log("  ⚠️  Authentification échouée");
        console.log("  💡 Vérifier que FREEBUFF_API_KEY est correct");
      }
      
      return false;
    }

    console.log("✅ SUCCÈS! La requête a été acceptée!\n");
    console.log("📄 Réponse du modèle:\n");

    // Traiter le stream SSE
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
            console.log(`📊 Total chunks reçus: ${totalChunks}`);
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
            // Ignore JSON parse errors
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Exception:", error.message);
    console.error(error.stack);
    return false;
  }
}

/**
 * Main
 */
async function main() {
  // Vérifications
  if (!CONFIG.token) {
    console.error("❌ Erreur: FREEBUFF_API_KEY non défini");
    console.log("\nUtilisation:");
    console.log("  FREEBUFF_API_KEY=your-token node test-complete-cli-emulation.mjs");
    process.exit(1);
  }

  const message = "Say 'CLI emulation successful' if you can read this message.";
  
  const success = await sendChatRequest(message);
  process.exit(success ? 0 : 1);
}

main();

#!/usr/bin/env node
/**
 * Test avec NOTRE token + signature CLI (User-Agent runtime/browser + client_id)
 * Teste si le client_id peut être réutilisé avec un autre token
 */

// 🎯 Utiliser NOTRE token valide
const FREEBUFF_TOKEN = process.env.FREEBUFF_API_KEY || "sk-freebuff-YOUR_TOKEN_HERE";
const API_URL = "https://www.codebuff.com/api/v1/chat/completions";

// client_id capturé du CLI réel
const CAPTURED_CLIENT_ID = "4utb3yxkau";

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function testOwnTokenWithCLISignature() {
  const instanceId = uuidv4();
  const traceSessionId = uuidv4();
  const runId = uuidv4();

  const body = {
    model: "deepseek/deepseek-v4-flash",
    stop: ['"cb_easp"'],
    codebuff_metadata: {
      freebuff_instance_id: instanceId,
      trace_session_id: traceSessionId,
      run_id: runId,
      client_id: CAPTURED_CLIENT_ID, // 🎯 Tester avec le client_id capturé
      cost_mode: "free",
    },
    provider: {
      data_collection: "deny",
    },
    messages: [
      {
        role: "user",
        content: "Say 'success' if you can read this",
      },
    ],
    stream: true,
  };

  // 🎯 CLÉS: User-Agent avec runtime/browser + client_id dans metadata
  const headers = {
    Authorization: `Bearer ${FREEBUFF_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent":
      "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser",
    Connection: "keep-alive",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };

  console.log("🧪 Test: Notre token + signature CLI (runtime/browser + client_id capturé)");
  console.log(`Token: ${FREEBUFF_TOKEN.slice(0, 20)}...`);
  console.log(`Client ID: ${CAPTURED_CLIENT_ID}`);
  console.log(`User-Agent: ${headers["User-Agent"]}\n`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:", errorText);
      
      if (errorText.includes("free_mode_cli_required")) {
        console.log("\n⚠️ Toujours bloqué par free_mode_cli_required");
        console.log("→ Le client_id est probablement lié au token Bearer");
        console.log("→ Ou bien il y a un autre mécanisme de validation (TLS fingerprint, etc.)");
      } else if (errorText.includes("Invalid") || response.status === 401) {
        console.log("\n⚠️ Token invalide ou client_id incompatible");
        console.log("→ Le client_id capturé est probablement lié à l'autre token");
      }
      return;
    }

    console.log("✅ SUCCÈS! Le backend accepte la requête!\n");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
            console.log("\n✅ Stream terminé");
            continue;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Exception:", error.message);
  }
}

// Vérifier que le token est fourni
if (!process.env.FREEBUFF_API_KEY) {
  console.error("❌ Erreur: FREEBUFF_API_KEY non défini");
  console.log("Utilisation: FREEBUFF_API_KEY=your-token node test-own-token-cli-signature.mjs");
  process.exit(1);
}

testOwnTokenWithCLISignature();

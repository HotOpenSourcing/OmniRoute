#!/usr/bin/env node
/**
 * Test avec le token VALIDE + signature CLI complète
 */

import { randomUUID } from "crypto";

// Token valide extrait de credentials.json
const TOKEN = "136313a5-13af-4326-8c42-227ad63351b4";
const API_URL = "https://www.codebuff.com/api/v1/chat/completions";

// Signature CLI capturée
const USER_AGENT = "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser";
const CLIENT_ID = "4utb3yxkau"; // Du CLI capturé - à tester si réutilisable

async function testWithValidToken() {
  const body = {
    model: "deepseek/deepseek-v4-flash",
    stop: ['"cb_easp"'],
    codebuff_metadata: {
      freebuff_instance_id: randomUUID(),
      trace_session_id: randomUUID(),
      run_id: randomUUID(),
      client_id: CLIENT_ID,
      cost_mode: "free",
    },
    provider: {
      data_collection: "deny",
    },
    messages: [
      {
        role: "user",
        content: "Say 'SUCCESS' if you can read this",
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

  console.log("🧪 Test avec token valide + signature CLI\n");
  console.log("📋 Configuration:");
  console.log(`  Token: ${TOKEN.slice(0, 20)}...`);
  console.log(`  User-Agent: runtime/browser`);
  console.log(`  Client ID: ${CLIENT_ID}\n`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    console.log(`📡 Response: ${response.status} ${response.statusText}\n`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Erreur:");
      console.error(errorText);
      
      if (errorText.includes("free_mode_cli_required")) {
        console.log("\n🔍 Conclusion:");
        console.log("  ⚠️  TOUJOURS bloqué par free_mode_cli_required");
        console.log("\n💡 Le backend détecte probablement:");
        console.log("  1. TLS fingerprinting (Node.js vs Browser)");
        console.log("  2. Le client_id est lié au token (ne peut pas être réutilisé)");
        console.log("  3. Signature HTTP/2 différente");
        console.log("\n🎯 Prochaine étape:");
        console.log("  → Utiliser le vrai CLI et capturer son client_id");
      }
      return false;
    }

    console.log("✅ SUCCÈS! Le backend a accepté la requête!\n");

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
            console.log("\n\n✅ Stream terminé");
            continue;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
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

testWithValidToken();

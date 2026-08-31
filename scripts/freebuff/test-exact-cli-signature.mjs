#!/usr/bin/env node
/**
 * Test avec la signature EXACTE capturée du CLI réel
 * Reproduit tous les headers et metadata identifiés dans mimtcurls.txt
 */

const FREEBUFF_TOKEN = "008fc8b8-4d8e-49be-a16b-71eb1beb3cae";
const API_URL = "https://www.codebuff.com/api/v1/chat/completions";

// UUIDs capturés du CLI réel - on va les réutiliser pour voir si c'est lié au token
const CAPTURED_INSTANCE_ID = "70fb92e2-d3eb-4a4e-83c5-3d3de7326823";
const CAPTURED_CLIENT_ID = "4utb3yxkau";

// Generate fresh UUIDs for trace and run
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function testExactSignature() {
  const traceSessionId = uuidv4();
  const runId = uuidv4();

  const body = {
    model: "deepseek/deepseek-v4-flash",
    stop: ['"cb_easp"'], // Escaped quotes comme dans le CLI
    codebuff_metadata: {
      freebuff_instance_id: CAPTURED_INSTANCE_ID,
      trace_session_id: traceSessionId,
      run_id: runId,
      client_id: CAPTURED_CLIENT_ID, // 🎯 CRITIQUE
      cost_mode: "free",
    },
    provider: {
      data_collection: "deny",
    },
    messages: [
      {
        role: "user",
        content: "Say 'CLI signature test successful' if you can read this",
      },
    ],
    stream: true,
  };

  const headers = {
    Authorization: `Bearer ${FREEBUFF_TOKEN}`,
    "Content-Type": "application/json",
    // 🎯 CRITIQUE: User-Agent avec runtime/browser au lieu de runtime/node
    "User-Agent":
      "ai-sdk/openai-compatible/0.0.0-test/codebuff ai-sdk/provider-utils/3.0.20 runtime/browser",
    Connection: "keep-alive",
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
  };

  console.log("🧪 Test avec signature CLI exacte");
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log(
    "Metadata:",
    JSON.stringify(body.codebuff_metadata, null, 2),
    "\n"
  );

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
      return;
    }

    console.log("✅ Réponse streaming reçue!\n");

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

testExactSignature();

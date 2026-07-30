#!/usr/bin/env node
/**
 * Vérifie la validité du token Freebuff
 */

const TOKEN = "sk-freebuff-GfbFCEWJ0TYXB4z1qEXgHfABVNF7uy6xXZGOo";

async function verifyToken() {
  console.log("🔑 Vérification du token Freebuff...\n");
  console.log(`Token: ${TOKEN.slice(0, 30)}...\n`);

  try {
    const response = await fetch("https://www.codebuff.com/api/v1/me?fields=id,email", {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    const data = await response.json();
    console.log("\nRéponse:");
    console.log(JSON.stringify(data, null, 2));

    if (response.ok) {
      console.log("\n✅ Token valide!");
      return true;
    } else {
      console.log("\n❌ Token invalide ou expiré");
      return false;
    }
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    return false;
  }
}

verifyToken();

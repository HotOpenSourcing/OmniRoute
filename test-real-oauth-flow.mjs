// Test du protocole OAuth Z.AI avec pollToken généré localement
import crypto from 'crypto';

const baseUrl = "https://zcode.z.ai/api/v1";

console.log("=== TEST PROTOCOLE OAUTH Z.AI COMPLET ===\n");

// Étape 1: Générer pollToken localement
const pollToken = crypto.randomBytes(32).toString("hex");
console.log(`1. Poll Token généré: ${pollToken.substring(0, 20)}...${pollToken.substring(pollToken.length - 10)}`);
console.log(`   Longueur: ${pollToken.length} caractères\n`);

// Étape 2: Init avec pollToken
console.log("2. Initialisation du flow OAuth...");
try {
    const initResponse = await fetch(`${baseUrl}/oauth/cli/init`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${pollToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ provider: "zai" })
    });
    
    console.log(`   Status: ${initResponse.status} ${initResponse.statusText}`);
    
    if (!initResponse.ok) {
        const errorText = await initResponse.text();
        console.log(`   Error Response: ${errorText}`);
        process.exit(1);
    }
    
    const initData = await initResponse.json();
    console.log(`   Response:`, JSON.stringify(initData, null, 2));
    
    if (initData.code && initData.code !== 0) {
        console.log(`\n❌ Erreur serveur: ${initData.msg || 'Unknown error'}`);
        process.exit(1);
    }
    
    // Extraire les données de la réponse (peut être dans initData.data)
    const data = initData.data || initData;
    
    if (data.flow_id) {
        console.log(`\n✅ Flow initialisé avec succès !`);
        console.log(`   Flow ID: ${data.flow_id}`);
        console.log(`   Poll Token: ${data.poll_token?.substring(0, 20)}...`);
        console.log(`   Authorize URL: ${data.authorize_url}`);
        console.log(`   Poll Interval: ${data.poll_interval_sec} secondes`);
        console.log(`   Expires At: ${new Date(data.expires_at * 1000).toISOString()}`);
        
        console.log(`\n📝 PROCHAINES ÉTAPES:`);
        console.log(`   1. Visitez cette URL dans votre navigateur:`);
        console.log(`      ${data.authorize_url}`);
        console.log(`   2. Complétez l'authentification + CAPTCHA`);
        console.log(`   3. Ensuite, pollez l'endpoint avec:`);
        console.log(`      GET ${baseUrl}/oauth/cli/poll/${data.flow_id}`);
        console.log(`      Authorization: Bearer ${pollToken}`);
        console.log(`\n   Commande de test:`);
        console.log(`   node test-poll.mjs ${data.flow_id} ${pollToken}`);
    } else {
        console.log(`\n❌ Réponse inattendue - pas de flow_id`);
        console.log(`   Data:`, data);
    }
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    if (error.cause) {
        console.log(`   Cause:`, error.cause);
    }
}

console.log("\n=== FIN TEST ===");

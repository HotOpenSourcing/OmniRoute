// Test du flow OAuth CLI de Z.AI

const baseUrl = "https://zcode.z.ai/api/v1";

console.log("=== TEST FLOW OAUTH CLI Z.AI ===\n");

// Étape 1: Init
console.log("1. Initialisation du flow OAuth...");
try {
    const initResponse = await fetch(`${baseUrl}/oauth/cli/init`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });
    
    const initData = await initResponse.json();
    console.log(`   Status: ${initResponse.status}`);
    console.log(`   Response:`, JSON.stringify(initData, null, 2));
    
    if (initResponse.ok && initData.flow_id) {
        console.log(`\n✅ Flow initialisé avec succès !`);
        console.log(`   Flow ID: ${initData.flow_id}`);
        console.log(`   Poll Token: ${initData.poll_token?.substring(0, 20)}...`);
        console.log(`   Authorize URL: ${initData.authorize_url}`);
        console.log(`   Poll Interval: ${initData.poll_interval_sec} secondes`);
        console.log(`   Expires At: ${new Date(initData.expires_at * 1000).toISOString()}`);
        
        console.log(`\n📝 INSTRUCTIONS:`);
        console.log(`   1. Visitez cette URL: ${initData.authorize_url}`);
        console.log(`   2. Complétez l'authentification + CAPTCHA`);
        console.log(`   3. Ensuite, pollez l'endpoint avec:`);
        console.log(`      GET ${baseUrl}/oauth/cli/poll/${initData.flow_id}`);
        console.log(`      Authorization: Bearer ${initData.poll_token}`);
    } else {
        console.log(`\n❌ Échec de l'initialisation`);
    }
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

console.log("\n=== FIN TEST ===");

// Test du flow OAuth CLI de Z.AI - Version avec réponse brute

const baseUrl = "https://zcode.z.ai/api/v1";

console.log("=== TEST FLOW OAUTH CLI Z.AI (DEBUG) ===\n");

// Étape 1: Init avec debug complet
console.log("1. Initialisation du flow OAuth...");
try {
    const initResponse = await fetch(`${baseUrl}/oauth/cli/init`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "ZCode/1.0"
        },
        body: JSON.stringify({})
    });
    
    console.log(`   Status: ${initResponse.status} ${initResponse.statusText}`);
    console.log(`   Headers:`, Object.fromEntries(initResponse.headers.entries()));
    
    const responseText = await initResponse.text();
    console.log(`   Raw Response (${responseText.length} bytes):`, responseText.substring(0, 500));
    
    if (responseText) {
        try {
            const initData = JSON.parse(responseText);
            console.log(`   Parsed JSON:`, JSON.stringify(initData, null, 2));
            
            if (initData.flow_id) {
                console.log(`\n✅ Flow initialisé !`);
                console.log(`   Flow ID: ${initData.flow_id}`);
                console.log(`   Poll Token: ${initData.poll_token?.substring(0, 20)}...`);
                console.log(`   Authorize URL: ${initData.authorize_url}`);
            }
        } catch (parseError) {
            console.log(`   ❌ JSON Parse Error: ${parseError.message}`);
        }
    }
} catch (error) {
    console.log(`   ❌ Fetch Error: ${error.message}`);
    console.log(`   Stack:`, error.stack);
}

// Test avec client_id
console.log("\n\n2. Test avec client_id...");
try {
    const initResponse = await fetch(`${baseUrl}/oauth/cli/init`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "User-Agent": "ZCode/1.0"
        },
        body: JSON.stringify({
            client_id: "client_P8X5CMWmlaRO9gyO-KSqtg"
        })
    });
    
    console.log(`   Status: ${initResponse.status} ${initResponse.statusText}`);
    const responseText = await initResponse.text();
    console.log(`   Response:`, responseText.substring(0, 300));
    
    if (responseText) {
        try {
            const data = JSON.parse(responseText);
            console.log(`   Parsed:`, JSON.stringify(data, null, 2));
        } catch (e) {
            console.log(`   Not JSON`);
        }
    }
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

console.log("\n=== FIN TEST ===");

// Test du flow OAuth Z.AI Coding Plan avec refresh de session

const code = "code-ff102b4e10dd"; // Remplacer par un nouveau code si expiré

console.log("=== Test Z.AI Coding Plan OAuth Flow ===\n");

// Test 1: Vérifier si le code est une session temporaire
console.log("1. Test direct du code comme session token:");
try {
    const response = await fetch("https://zcode.z.ai/api/v1/zcode-plan/billing/balance", {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${code}`,
            "Content-Type": "application/json"
        }
    });
    
    console.log(`   Status: ${response.status}`);
    const text = await response.text();
    console.log(`   Response: ${text.substring(0, 200)}`);
} catch (error) {
    console.log(`   Error: ${error.message}`);
}

// Test 2: Essayer l'endpoint de base avec le code
console.log("\n2. Test de l'endpoint de base /zcode-plan:");
try {
    const response = await fetch("https://zcode.z.ai/api/v1/zcode-plan", {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${code}`,
            "Content-Type": "application/json"
        }
    });
    
    console.log(`   Status: ${response.status}`);
    const text = await response.text();
    console.log(`   Response: ${text.substring(0, 200)}`);
} catch (error) {
    console.log(`   Error: ${error.message}`);
}

// Test 3: Essayer avec un header personnalisé (comme ZCode pourrait faire)
console.log("\n3. Test avec header X-ZCode-Session:");
try {
    const response = await fetch("https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages", {
        method: "POST",
        headers: {
            "X-ZCode-Session": code,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "glm-5.2",
            messages: [{ role: "user", content: "test" }],
            max_tokens: 10
        })
    });
    
    console.log(`   Status: ${response.status}`);
    const text = await response.text();
    console.log(`   Response: ${text.substring(0, 200)}`);
} catch (error) {
    console.log(`   Error: ${error.message}`);
}

// Test 4: Essayer un échange de session
console.log("\n4. Test d'échange de session OAuth:");
const exchangeEndpoints = [
    "/api/v1/auth/session",
    "/api/v1/auth/exchange",
    "/api/v1/oauth/session",
    "/api/v1/zcode-plan/auth/session"
];

for (const endpoint of exchangeEndpoints) {
    try {
        const response = await fetch(`https://zcode.z.ai${endpoint}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                code: code,
                grant_type: "authorization_code"
            })
        });
        
        console.log(`   ${endpoint}: ${response.status}`);
        if (response.status !== 404 && response.status !== 405) {
            const text = await response.text();
            console.log(`   Response: ${text.substring(0, 150)}`);
        }
    } catch (error) {
        console.log(`   ${endpoint}: Error - ${error.message}`);
    }
}

console.log("\n=== Tests terminés ===");

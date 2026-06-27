// Test variations de paramètres OAuth pour Z.AI

const code = "code-478888f44eb3";
const clientId = "client_P8X5CMWmlaRO9gyO-KSqtg";
const redirectUri = "zcode://zai-auth/callback";
const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const tests = [
    {
        name: "JSON standard OAuth",
        body: JSON.stringify({
            grant_type: "authorization_code",
            code: code,
            client_id: clientId,
            redirect_uri: redirectUri
        }),
        contentType: "application/json"
    },
    {
        name: "JSON avec code_verifier",
        body: JSON.stringify({
            grant_type: "authorization_code",
            code: code,
            client_id: clientId,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier
        }),
        contentType: "application/json"
    },
    {
        name: "JSON sans redirect_uri",
        body: JSON.stringify({
            grant_type: "authorization_code",
            code: code,
            client_id: clientId
        }),
        contentType: "application/json"
    },
    {
        name: "JSON code + client_id uniquement",
        body: JSON.stringify({
            code: code,
            client_id: clientId
        }),
        contentType: "application/json"
    },
    {
        name: "JSON code uniquement",
        body: JSON.stringify({
            code: code
        }),
        contentType: "application/json"
    },
    {
        name: "Form URL encoded standard",
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            client_id: clientId,
            redirect_uri: redirectUri
        }).toString(),
        contentType: "application/x-www-form-urlencoded"
    },
    {
        name: "Form avec code_verifier",
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            client_id: clientId,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier
        }).toString(),
        contentType: "application/x-www-form-urlencoded"
    }
];

console.log("=== Test variations paramètres OAuth ===\n");
console.log(`Code: ${code}`);
console.log(`Client ID: ${clientId}\n`);

for (const test of tests) {
    console.log(`\nTest: ${test.name}`);
    console.log(`Content-Type: ${test.contentType}`);
    console.log(`Body: ${test.body.substring(0, 100)}${test.body.length > 100 ? '...' : ''}`);
    
    try {
        const response = await fetch("https://zcode.z.ai/api/v1/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": test.contentType
            },
            body: test.body
        });
        
        const text = await response.text();
        
        if (response.ok) {
            console.log(`✅ SUCCESS: ${response.status}`);
            console.log(`Response: ${text}`);
            
            // Si succès, arrêter les tests
            console.log("\n🎉 Token échange réussi !");
            process.exit(0);
        } else {
            console.log(`❌ Status: ${response.status}`);
            console.log(`Response: ${text.substring(0, 150)}`);
        }
    } catch (error) {
        console.log(`❌ Error: ${error.message}`);
    }
}

console.log("\n=== Aucune variation n'a fonctionné ===");

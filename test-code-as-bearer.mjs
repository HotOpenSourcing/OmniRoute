// Test : utiliser le code OAuth comme Bearer token directement
const baseUrl = "https://zcode.z.ai/api/v1/zcode-plan/anthropic";

console.log("=== TEST : CODE OAUTH COMME BEARER TOKEN ===\n");

// Code OAuth reçu du callback
const oauthCode = "code-b4d54ad05eb0"; // Ancien code, probablement expiré mais pour tester le format

console.log(`1. Test avec code OAuth comme Bearer token...`);
console.log(`   Code: ${oauthCode}\n`);

try {
    const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${oauthCode}`,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
            model: "glm-5-turbo",
            max_tokens: 100,
            messages: [{
                role: "user",
                content: "Hello"
            }]
        })
    });
    
    console.log(`2. Response:`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    const responseText = await response.text();
    console.log(`   Body: ${responseText.substring(0, 500)}`);
    
    if (response.ok) {
        console.log(`\n✅ SUCCESS! Le code OAuth fonctionne directement comme Bearer token!`);
    } else {
        console.log(`\n❌ Failed - Le code OAuth ne fonctionne pas directement`);
        console.log(`\nCONCLUSION:`);
        console.log(`Le protocole OAuth Z.AI nécessite probablement:`);
        console.log(`1. Un échange de code via un endpoint non-public (CLI-only)`);
        console.log(`2. OU un flow OAuth complet qui n'est pas encore déployé sur le serveur public`);
        console.log(`3. OU l'utilisation de l'application ZCode elle-même pour obtenir le token`);
        console.log(`\nRECOMMANDATION:`);
        console.log(`Implémenter un "Manual Token Import" dans OmniRoute où:`);
        console.log(`- L'utilisateur se connecte via ZCode`);
        console.log(`- Extrait le Bearer token depuis ZCode DevTools (F12 → Network → Authorization header)`);
        console.log(`- Colle le token dans OmniRoute pour l'utiliser`);
    }
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

console.log("\n=== FIN TEST ===");

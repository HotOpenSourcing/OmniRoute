// Recherche ciblée du protocole OAuth Z.AI
import { readFileSync } from 'fs';

const codeFile = "C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs";
const content = readFileSync(codeFile, 'utf8');

console.log("=== RECHERCHE PROTOCOLE Z.AI ===\n");

// 1. Chercher spécifiquement "zai" + "oauth" dans le même contexte
console.log("1. PATTERNS ZAI + OAUTH:");
const zaiOauthPattern = /zai[^}]{50,300}oauth|oauth[^}]{50,300}zai/gi;
const matches1 = [...content.matchAll(zaiOauthPattern)].slice(0, 5);
for (const match of matches1) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 250)}...`);
}

// 2. Chercher le contexte autour de "chat.z.ai"
console.log("\n\n2. CONTEXTE CHAT.Z.AI:");
const chatZaiPattern = /chat\.z\.ai[^}]{50,300}/gi;
const matches2 = [...content.matchAll(chatZaiPattern)].slice(0, 5);
for (const match of matches2) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 250)}...`);
}

// 3. Chercher les fonctions qui contiennent "code" + "exchange" + "zai"
console.log("\n\n3. FONCTIONS EXCHANGE ZAI:");
const zaiExchangePattern = /function[^{]{0,100}\{[^}]{0,500}(zai|z\.ai)[^}]{0,500}(code|token|exchange)[^}]{0,300}\}/gi;
const matches3 = [...content.matchAll(zaiExchangePattern)].slice(0, 3);
for (const match of matches3) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 300)}...`);
}

// 4. Chercher les URLs avec "/oauth/" + "token"
console.log("\n\n4. ENDPOINTS OAUTH TOKEN:");
const tokenEndpointPattern = /["'`](https?:\/\/[^"'`]*\/oauth[^"'`]*token[^"'`]*)["'`]/gi;
const matches4 = [...content.matchAll(tokenEndpointPattern)].slice(0, 10);
for (const match of matches4) {
    console.log(`  ${match[1]}`);
}

// 5. Chercher le pattern "poll" (CLI polling flow)
console.log("\n\n5. CLI POLLING FLOW:");
const pollPattern = /poll[^}]{50,300}(token|code|flow)/gi;
const matches5 = [...content.matchAll(pollPattern)].slice(0, 5);
for (const match of matches5) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 200)}...`);
}

// 6. Chercher les patterns de body avec "appId" ou "authCode"
console.log("\n\n6. BODY STRUCTURES:");
const bodyPattern = /\{[^}]{0,200}(appId|authCode|code|client_id)[^}]{0,300}\}/gi;
const matches6 = [...content.matchAll(bodyPattern)].slice(0, 8);
for (const match of matches6) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    if (text.includes('code') || text.includes('token') || text.includes('oauth')) {
        console.log(`  ${text.substring(0, 200)}...`);
    }
}

// 7. Chercher spécifiquement "zcode.z.ai" + "oauth"
console.log("\n\n7. ZCODE.Z.AI OAUTH:");
const zcodeOauthPattern = /zcode\.z\.ai[^}]{50,400}/gi;
const matches7 = [...content.matchAll(zcodeOauthPattern)].slice(0, 5);
for (const match of matches7) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 300)}...`);
}

// 8. Chercher les patterns de headers avec Authorization
console.log("\n\n8. AUTHORIZATION HEADERS:");
const authPattern = /Authorization[^}]{20,150}/gi;
const matches8 = [...content.matchAll(authPattern)].slice(0, 8);
for (const match of matches8) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 150)}...`);
}

console.log("\n\n=== FIN RECHERCHE ===");

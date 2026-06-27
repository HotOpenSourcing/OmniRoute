// Extraction du flow CLI OAuth complet
import { readFileSync } from 'fs';

const codeFile = "C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs";
const content = readFileSync(codeFile, 'utf8');

console.log("=== FLOW CLI OAUTH Z.AI ===\n");

// 1. Chercher le flow "init" -> "poll"
console.log("1. FLOW INIT -> POLL:");
const initPattern = /init[^}]{100,500}(authorize_url|flow_id|poll_token)[^}]{100,500}/gi;
const initMatches = [...content.matchAll(initPattern)].slice(0, 3);
for (const match of initMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`\n  ${text.substring(0, 400)}...`);
}

// 2. Chercher les endpoints CLI
console.log("\n\n2. ENDPOINTS CLI:");
const cliEndpointPattern = /(\/api\/v1\/[^"'\s]+cli[^"'\s]*)/gi;
const cliEndpoints = [...new Set([...content.matchAll(cliEndpointPattern)].map(m => m[1]))];
cliEndpoints.forEach(url => console.log(`  ${url}`));

// 3. Chercher le pattern "poll" avec Authorization
console.log("\n\n3. POLL WITH AUTH:");
const pollAuthPattern = /poll[^}]{50,300}Authorization[^}]{50,300}/gi;
const pollAuthMatches = [...content.matchAll(pollAuthPattern)].slice(0, 3);
for (const match of pollAuthMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`\n  ${text.substring(0, 300)}...`);
}

// 4. Chercher la structure de réponse OAuth
console.log("\n\n4. OAUTH RESPONSE STRUCTURE:");
const responsePattern = /\{[^}]{0,100}(access_token|refresh_token|user_id)[^}]{0,200}\}/gi;
const responseMatches = [...content.matchAll(responsePattern)].slice(0, 10);
const uniqueResponses = new Set();
for (const match of responseMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    if (text.includes('access_token') && text.length < 300) {
        uniqueResponses.add(text);
    }
}
uniqueResponses.forEach(text => console.log(`  ${text.substring(0, 250)}...`));

// 5. Chercher spécifiquement "flowId" et "pollToken"
console.log("\n\n5. FLOW ID & POLL TOKEN:");
const flowTokenPattern = /(flowId|pollToken|flow_id|poll_token)[^}]{50,200}/gi;
const flowTokenMatches = [...content.matchAll(flowTokenPattern)].slice(0, 8);
for (const match of flowTokenMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 180)}...`);
}

// 6. Chercher les URLs complètes avec /oauth/cli/
console.log("\n\n6. OAUTH CLI URLS:");
const oauthCliPattern = /["'`]([^"'`]*\/oauth\/cli\/[^"'`]*)["'`]/gi;
const oauthCliUrls = [...new Set([...content.matchAll(oauthCliPattern)].map(m => m[1]))];
oauthCliUrls.forEach(url => console.log(`  ${url}`));

// 7. Chercher le pattern exact d'échange
console.log("\n\n7. TOKEN EXCHANGE PATTERN:");
const exchangePattern = /exchange[^}]{100,400}(access_token|code|token)[^}]{100,300}/gi;
const exchangeMatches = [...content.matchAll(exchangePattern)].slice(0, 3);
for (const match of exchangeMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`\n  ${text.substring(0, 350)}...`);
}

console.log("\n\n=== FIN EXTRACTION ===");

// Analyse approfondie du protocole OAuth Z.AI
import { readFileSync } from 'fs';

const codeFile = "C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs";

console.log("=== ANALYSE PROTOCOLE OAUTH Z.AI ===\n");

const content = readFileSync(codeFile, 'utf8');

// 1. Chercher les fonctions d'échange de token
console.log("1. FONCTIONS D'ÉCHANGE TOKEN:");
const tokenFunctions = [
    /function\s+\w*[Tt]oken[Ee]xchange\w*\s*\([^)]*\)\s*\{[^}]{0,500}\}/g,
    /exchangeCode[^(]*\([^)]*\)\s*\{[^}]{0,300}\}/g,
    /getAccessToken[^(]*\([^)]*\)\s*\{[^}]{0,300}\}/g,
    /oauth.*token[^{]{0,100}\{[^}]{0,300}\}/gi
];

for (const pattern of tokenFunctions) {
    const matches = [...content.matchAll(pattern)].slice(0, 2);
    if (matches.length > 0) {
        console.log(`\n  Pattern: ${pattern.source.substring(0, 40)}...`);
        for (const match of matches) {
            const text = match[0].replace(/\s+/g, ' ').substring(0, 200);
            console.log(`    ${text}...`);
        }
    }
}

// 2. Chercher les URLs de token complètes
console.log("\n\n2. URLs DE TOKEN:");
const urlPattern = /https:\/\/[^"\s]*oauth[^"\s]*token[^"\s]*/gi;
const tokenUrls = [...new Set([...content.matchAll(urlPattern)].map(m => m[0]))].slice(0, 10);
tokenUrls.forEach(url => console.log(`  ${url}`));

// 3. Chercher les appels fetch POST
console.log("\n\n3. REQUÊTES POST OAUTH:");
const postPattern = /fetch\([^,]+,\s*\{[^}]*method:\s*["']POST["'][^}]*\}/gi;
const postMatches = [...content.matchAll(postPattern)].slice(0, 3);
for (const match of postMatches) {
    const text = match[0].replace(/\s+/g, ' ').substring(0, 250);
    console.log(`  ${text}...`);
}

// 4. Chercher les body parameters
console.log("\n\n4. BODY PARAMETERS:");
const bodyParams = {
    'grant_type': /grant_type["']?\s*:\s*["']([^"']+)/gi,
    'code': /(?:^|[,{])\s*code["']?\s*:\s*["']?([^"'}\s,]+)/gi,
    'client_id': /client_id["']?\s*:\s*["']([^"']+)/gi,
    'code_verifier': /code_verifier["']?\s*:\s*["']([^"']+)/gi,
    'redirect_uri': /redirect_uri["']?\s*:\s*["']([^"']+)/gi
};

for (const [param, pattern] of Object.entries(bodyParams)) {
    const matches = [...new Set([...content.matchAll(pattern)].map(m => m[1]))].slice(0, 3);
    if (matches.length > 0) {
        console.log(`\n  ${param}:`);
        matches.forEach(value => console.log(`    ${value}`));
    }
}

// 5. Chercher les headers OAuth
console.log("\n\n5. HEADERS OAUTH:");
const authHeaderPattern = /["']Authorization["']:\s*["']([^"']+)/gi;
const authHeaders = [...new Set([...content.matchAll(authHeaderPattern)].map(m => m[1]))].slice(0, 5);
authHeaders.forEach(header => console.log(`  ${header}`));

// 6. Chercher le contexte autour de "zcode-plan"
console.log("\n\n6. CONTEXTE ZCODE-PLAN:");
const planPattern = /zcode-plan[^}]{0,200}/gi;
const planMatches = [...content.matchAll(planPattern)].slice(0, 5);
for (const match of planMatches) {
    const text = match[0].replace(/\s+/g, ' ').substring(0, 150);
    console.log(`  ${text}...`);
}

// 7. Chercher les références au refresh
console.log("\n\n7. REFRESH TOKEN:");
const refreshPattern = /refresh[^{]{0,100}\{[^}]{0,300}\}/gi;
const refreshMatches = [...content.matchAll(refreshPattern)].slice(0, 3);
for (const match of refreshMatches) {
    const text = match[0].replace(/\s+/g, ' ').substring(0, 200);
    console.log(`  ${text}...`);
}

// 8. Chercher le flow complet authorize -> token
console.log("\n\n8. FLOW AUTHORIZE -> TOKEN:");
const flowPattern = /authorize[^}]{100,400}token|oauth[^}]{100,400}exchange/gi;
const flowMatches = [...content.matchAll(flowPattern)].slice(0, 2);
for (const match of flowMatches) {
    const text = match[0].replace(/\s+/g, ' ').substring(0, 300);
    console.log(`  ${text}...`);
}

// 9. Chercher les patterns de vérification CAPTCHA
console.log("\n\n9. INTEGRATION CAPTCHA:");
const captchaPattern = /captcha[^"\s]{0,50}|verify[^"\s]{0,30}/gi;
const captchaRefs = [...new Set([...content.matchAll(captchaPattern)].map(m => m[0]))].slice(0, 10);
captchaRefs.forEach(ref => console.log(`  ${ref}`));

console.log("\n\n=== ANALYSE TERMINÉE ===");

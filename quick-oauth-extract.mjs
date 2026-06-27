// Extraction ciblée et rapide du protocol OAuth
import { readFileSync } from 'fs';

const codeFile = "C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs";
const content = readFileSync(codeFile, 'utf8');

console.log("=== EXTRACTION RAPIDE PROTOCOL OAUTH ===\n");

// 1. Chercher "loginZCodeCli" qui semble être la fonction principale
console.log("1. LOGIN ZCODE CLI FUNCTION:");
const loginPattern = /loginZCodeCli[^}]{200,600}/gi;
const loginMatches = [...content.matchAll(loginPattern)].slice(0, 2);
for (const match of loginMatches) {
    const text = match[0].replace(/\s+/g, ' ');
    console.log(`  ${text.substring(0, 400)}...`);
}

// 2. Chercher "onAuthorizeUrl" callback
console.log("\n2. ON AUTHORIZE URL:");
const authorizePattern = /onAuthorizeUrl[^}]{100,300}/gi;
const authorizeMatches = [...content.matchAll(authorizePattern)].slice(0, 2);
for (const match of authorizeMatches) {
    const text = match[0].replace(/\s+/g, ' ');
    console.log(`  ${text.substring(0, 250)}...`);
}

// 3. Chercher directement les URLs complètes avec zcode.z.ai
console.log("\n3. FULL ZCODE.Z.AI URLS:");
const fullUrlPattern = /https:\/\/zcode\.z\.ai[^\s"'`]{1,80}/gi;
const urls = [...new Set([...content.matchAll(fullUrlPattern)].map(m => m[0]))];
urls.forEach(url => console.log(`  ${url}`));

// 4. Chercher le pattern "init" près de "oauth"
console.log("\n4. OAUTH INIT PATTERN:");
const initOauthPattern = /oauth[^}]{0,50}init|init[^}]{0,50}oauth/gi;
const initOauthMatches = [...content.matchAll(initOauthPattern)].slice(0, 5);
for (const match of initOauthMatches) {
    const text = match[0].replace(/\s+/g, ' ');
    console.log(`  ${text.substring(0, 100)}`);
}

// 5. Chercher "authorize_url" avec contexte
console.log("\n5. AUTHORIZE_URL CONTEXT:");
const authUrlPattern = /authorize_url[^}]{50,150}/gi;
const authUrlMatches = [...content.matchAll(authUrlPattern)].slice(0, 5);
for (const match of authUrlMatches) {
    const text = match[0].replace(/\s+/g, ' ');
    console.log(`  ${text}`);
}

console.log("\n=== FIN EXTRACTION ===");

// Extraction du pattern exact de construction d'URL OAuth CLI
import { readFileSync } from 'fs';

const codeFile = "C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs";
const content = readFileSync(codeFile, 'utf8');

console.log("=== RECHERCHE URL OAUTH CLI EXACTE ===\n");

// 1. Chercher le pattern de construction d'URL avec oauth/cli
console.log("1. CONSTRUCTION URL /oauth/cli/init:");
const initUrlPattern = /["`'].*oauth\/cli\/init["`'][^}]{0,200}/gi;
const initMatches = [...content.matchAll(initUrlPattern)].slice(0, 5);
for (const match of initMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 200)}`);
}

// 2. Chercher comment la baseUrl est utilisée
console.log("\n2. BASE URL USAGE:");
const baseUrlPattern = /baseUrl[^}]{50,150}oauth/gi;
const baseMatches = [...content.matchAll(baseUrlPattern)].slice(0, 5);
for (const match of baseMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 150)}`);
}

// 3. Chercher le template literal complet
console.log("\n3. TEMPLATE LITERALS OAUTH:");
const templatePattern = /\$\{[^}]*\}\/oauth\/cli\/[^}`'"]{1,30}/gi;
const templateMatches = [...content.matchAll(templatePattern)];
const uniqueTemplates = [...new Set(templateMatches.map(m => m[0]))];
uniqueTemplates.forEach(t => console.log(`  ${t}`));

// 4. Chercher "init" dans le contexte OAuth
console.log("\n4. INIT CONTEXT:");
const initContextPattern = /init[^}]{20,100}oauth[^}]{20,100}/gi;
const initContextMatches = [...content.matchAll(initContextPattern)].slice(0, 5);
for (const match of initContextMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 150)}`);
}

// 5. Chercher les fonctions qui font des requêtes HTTP
console.log("\n5. HTTP REQUEST FUNCTIONS:");
const httpPattern = /(fetch|request|httpClient)[^}]{50,200}oauth\/cli/gi;
const httpMatches = [...content.matchAll(httpPattern)].slice(0, 5);
for (const match of httpMatches) {
    const text = match[0].replace(/\s+/g, ' ').replace(/[^\x20-\x7E]/g, '');
    console.log(`  ${text.substring(0, 200)}`);
}

// 6. Chercher "zcode.z.ai" et voir ce qui suit
console.log("\n6. ZCODE.Z.AI PATHS:");
const zcodePattern = /zcode\.z\.ai[^"'`\s]{1,100}/gi;
const zcodePaths = [...new Set([...content.matchAll(zcodePattern)].map(m => m[0]))];
zcodePaths.forEach(path => console.log(`  ${path}`));

console.log("\n=== FIN RECHERCHE ===");

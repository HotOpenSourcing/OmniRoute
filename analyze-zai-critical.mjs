import { readFileSync, writeFileSync } from 'fs';

const bundlePath = 'C:\\Users\\amine\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs';
const bundle = readFileSync(bundlePath, 'utf8');

console.log('🔍 Analyse critique du protocole Z.AI...\n');

// 1. Extraire les endpoints OAuth complets
const oauthEndpoints = [];
const oauthRegex = /["']([^"']*oauth[^"']*)["']/gi;
let match;
while ((match = oauthRegex.exec(bundle)) !== null) {
  const endpoint = match[1];
  if (endpoint.includes('/') && !oauthEndpoints.includes(endpoint)) {
    oauthEndpoints.push(endpoint);
  }
}

console.log('📍 ENDPOINTS OAUTH DÉCOUVERTS:');
console.log(oauthEndpoints.filter(e => !e.includes('node_modules')).join('\n'));
console.log('');

// 2. Extraire les fonctions de refresh token
const refreshFunctions = [];
const refreshRegex = /function\s+(\w*refresh\w*)\s*\([^)]*\)\s*{[^}]{0,500}}/gi;
while ((match = refreshRegex.exec(bundle)) !== null) {
  refreshFunctions.push(match[0].substring(0, 300));
}

console.log('🔄 FONCTIONS REFRESH TOKEN:');
console.log(`Trouvé ${refreshFunctions.length} fonctions`);
if (refreshFunctions.length > 0) {
  console.log('Première fonction:');
  console.log(refreshFunctions[0]);
}
console.log('');

// 3. Extraire les intervalles de polling/refresh
const intervals = new Set();
const intervalRegex = /setInterval\([^,]+,\s*(\d+)\)/g;
while ((match = intervalRegex.exec(bundle)) !== null) {
  intervals.add(parseInt(match[1]));
}

console.log('⏱️  INTERVALLES DE POLLING:');
const sortedIntervals = Array.from(intervals).sort((a, b) => a - b);
sortedIntervals.forEach(i => {
  if (i < 100000) { // Filtrer les grandes valeurs
    console.log(`  ${i}ms (${(i/1000).toFixed(1)}s)`);
  }
});
console.log('');

// 4. Extraire la structure de stockage des tokens
const tokenStorage = [];
const storageRegex = /"(oauth:[^"]+)"/g;
while ((match = storageRegex.exec(bundle)) !== null) {
  if (!tokenStorage.includes(match[1])) {
    tokenStorage.push(match[1]);
  }
}

console.log('💾 CLÉS DE STOCKAGE DES TOKENS:');
console.log(tokenStorage.join('\n'));
console.log('');

// 5. Extraire les headers personnalisés
const customHeaders = new Set();
const headerRegex = /["'](X-[A-Za-z-]+)["']\s*:/g;
while ((match = headerRegex.exec(bundle)) !== null) {
  customHeaders.add(match[1]);
}

console.log('📋 HEADERS PERSONNALISÉS:');
Array.from(customHeaders).forEach(h => console.log(`  ${h}`));
console.log('');

// 6. Extraire les codes d'erreur gérés
const errorCodes = new Set();
const errorRegex = /case\s+(\d{3}):|status\s*===\s*(\d{3})|statusCode\s*===\s*(\d{3})/g;
while ((match = errorRegex.exec(bundle)) !== null) {
  const code = match[1] || match[2] || match[3];
  if (code && code.length === 3) {
    errorCodes.add(code);
  }
}

console.log('⚠️  CODES HTTP GÉRÉS:');
console.log(Array.from(errorCodes).sort().join(', '));
console.log('');

// 7. Chercher le flow CLI polling complet
const cliFlowMatches = [];
const cliInitRegex = /async\s+init\s*\([^)]*\)\s*{[^}]{0,800}}/gi;
while ((match = cliInitRegex.exec(bundle)) !== null) {
  cliFlowMatches.push(match[0]);
}

console.log('🔐 FLOW CLI OAUTH:');
if (cliFlowMatches.length > 0) {
  console.log('Init function trouvée:');
  console.log(cliFlowMatches[0].substring(0, 500));
}
console.log('');

// 8. Extraire les constantes de domaine
const domains = [];
const domainRegex = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi;
while ((match = domainRegex.exec(bundle)) !== null) {
  const domain = match[0];
  if ((domain.includes('z.ai') || domain.includes('bigmodel.cn')) && !domains.includes(domain)) {
    domains.push(domain);
  }
}

console.log('🌐 DOMAINES Z.AI:');
console.log(domains.join('\n'));
console.log('');

// 9. Chercher les valeurs de timeout
const timeouts = new Set();
const timeoutRegex = /timeout[:\s]*(\d+)/gi;
let count = 0;
while ((match = timeoutRegex.exec(bundle)) !== null && count < 50) {
  const val = parseInt(match[1]);
  if (val > 100 && val < 600000) { // Entre 100ms et 10min
    timeouts.add(val);
    count++;
  }
}

console.log('⏲️  TIMEOUTS:');
Array.from(timeouts).sort((a,b) => a-b).slice(0, 10).forEach(t => {
  console.log(`  ${t}ms (${(t/1000).toFixed(1)}s)`);
});
console.log('');

// 10. Extraire les patterns de retry
const retryPatterns = [];
const retryRegex = /retry[^{]{0,100}{[^}]{0,300}}/gi;
while ((match = retryRegex.exec(bundle)) !== null && retryPatterns.length < 3) {
  retryPatterns.push(match[0].substring(0, 200));
}

console.log('🔁 PATTERNS DE RETRY:');
retryPatterns.forEach((p, i) => {
  console.log(`\nPattern ${i+1}:`);
  console.log(p);
});

// Sauvegarder le rapport
const report = {
  timestamp: new Date().toISOString(),
  oauth_endpoints: oauthEndpoints.filter(e => !e.includes('node_modules')),
  refresh_functions_count: refreshFunctions.length,
  polling_intervals_ms: sortedIntervals.filter(i => i < 100000),
  token_storage_keys: tokenStorage,
  custom_headers: Array.from(customHeaders),
  http_error_codes: Array.from(errorCodes).sort(),
  domains: domains,
  timeouts_ms: Array.from(timeouts).sort((a,b) => a-b).slice(0, 10),
  cli_flow_found: cliFlowMatches.length > 0
};

writeFileSync('zai-critical-analysis.json', JSON.stringify(report, null, 2));
console.log('\n✅ Rapport sauvegardé dans zai-critical-analysis.json');

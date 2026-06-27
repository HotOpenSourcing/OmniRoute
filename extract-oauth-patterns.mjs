import { readFileSync, writeFileSync } from 'fs';

console.log('🔍 Extraction des patterns OAuth du code déminifié...\n');

const beautified = readFileSync('C:\\Users\\amine\\OmniRoute\\zai-decompiled\\zcode-beautified.js', 'utf8');

console.log('📍 RECHERCHE 1: Flow OAuth CLI complet');
console.log('=' .repeat(60));

// Chercher la fonction init
const initMatch = beautified.match(/async\s+init\s*\([^)]*\)\s*\{[^}]{0,1500}\}/s);
if (initMatch) {
  console.log('\n✅ Fonction init trouvée:');
  console.log(initMatch[0].substring(0, 800));
}

// Chercher la fonction poll
const pollMatch = beautified.match(/async\s+poll\s*\([^)]*\)\s*\{[^}]{0,1500}\}/s);
if (pollMatch) {
  console.log('\n✅ Fonction poll trouvée:');
  console.log(pollMatch[0].substring(0, 800));
}

console.log('\n\n📍 RECHERCHE 2: Constantes OAuth');
console.log('=' .repeat(60));

// Chercher oauthProviderId
const oauthProviderMatches = [...beautified.matchAll(/oauthProviderId:\s*["']([^"']+)["']/g)];
console.log(`\n✅ oauthProviderId trouvés (${oauthProviderMatches.length}):`);
oauthProviderMatches.forEach(m => console.log(`  - ${m[1]}`));

// Chercher les URLs OAuth
const oauthUrlMatches = [...beautified.matchAll(/["'](https?:\/\/[^"']*oauth[^"']*)["']/gi)];
console.log(`\n✅ URLs OAuth trouvées (${oauthUrlMatches.length}):`);
const uniqueUrls = [...new Set(oauthUrlMatches.map(m => m[1]))];
uniqueUrls.slice(0, 20).forEach(url => console.log(`  - ${url}`));

console.log('\n\n📍 RECHERCHE 3: Clés de stockage');
console.log('=' .repeat(60));

// Chercher oauth:zai:* patterns
const storageMatches = [...beautified.matchAll(/["'](oauth:[^"']+)["']/g)];
console.log(`\n✅ Clés de stockage trouvées (${storageMatches.length}):`);
const uniqueKeys = [...new Set(storageMatches.map(m => m[1]))];
uniqueKeys.forEach(key => console.log(`  - ${key}`));

console.log('\n\n📍 RECHERCHE 4: Endpoints /oauth/*');
console.log('=' .repeat(60));

// Chercher tous les paths /oauth/*
const oauthPaths = [...beautified.matchAll(/["'](\/(api\/)?oauth\/[^"']+)["']/g)];
console.log(`\n✅ Chemins OAuth trouvés (${oauthPaths.length}):`);
const uniquePaths = [...new Set(oauthPaths.map(m => m[1]))];
uniquePaths.forEach(path => console.log(`  - ${path}`));

console.log('\n\n📍 RECHERCHE 5: Headers personnalisés');
console.log('=' .repeat(60));

// Chercher X-* headers
const headerMatches = [...beautified.matchAll(/["'](X-[A-Za-z-]+)["']:\s*/g)];
console.log(`\n✅ Headers personnalisés (${headerMatches.length}):`);
const uniqueHeaders = [...new Set(headerMatches.map(m => m[1]))];
uniqueHeaders.forEach(h => console.log(`  - ${h}`));

console.log('\n\n📍 RECHERCHE 6: Fonction de génération de pollToken');
console.log('=' .repeat(60));

// Chercher randomBytes pattern
const randomBytesMatch = beautified.match(/function\s+\w+\(\)\s*\{[^}]*randomBytes[^}]{0,200}\}/s);
if (randomBytesMatch) {
  console.log('\n✅ Génération de pollToken:');
  console.log(randomBytesMatch[0]);
}

console.log('\n\n📍 RECHERCHE 7: Provider IDs et configurations');
console.log('=' .repeat(60));

// Chercher les configurations de providers
const providerConfigs = [...beautified.matchAll(/\{\s*id:\s*["']([^"']+)["'],\s*label:\s*["']([^"']+)["'][^}]{0,300}\}/gs)];
console.log(`\n✅ Configurations providers trouvées (${providerConfigs.length}):`);
providerConfigs.slice(0, 5).forEach(m => {
  console.log(`\nProvider: ${m[1]} (${m[2]})`);
  console.log(m[0].substring(0, 300));
});

console.log('\n\n📍 RECHERCHE 8: Codes erreur OAuth');
console.log('=' .repeat(60));

// Chercher les patterns de gestion d'erreur OAuth
const oauthErrorMatches = [...beautified.matchAll(/["'](coding_plan_[^"']+)["']/g)];
console.log(`\n✅ Codes erreur OAuth (${oauthErrorMatches.length}):`);
const uniqueErrors = [...new Set(oauthErrorMatches.map(m => m[1]))];
uniqueErrors.forEach(err => console.log(`  - ${err}`));

console.log('\n\n✅ Analyse terminée!\n');

// Sauvegarder le rapport
const report = {
  timestamp: new Date().toISOString(),
  oauth_provider_ids: [...new Set(oauthProviderMatches.map(m => m[1]))],
  oauth_urls: uniqueUrls,
  storage_keys: uniqueKeys,
  oauth_paths: uniquePaths,
  custom_headers: uniqueHeaders,
  error_codes: uniqueErrors,
  has_init_function: !!initMatch,
  has_poll_function: !!pollMatch,
  has_random_bytes: !!randomBytesMatch
};

writeFileSync('zai-oauth-analysis.json', JSON.stringify(report, null, 2));
console.log('📊 Rapport détaillé sauvegardé dans zai-oauth-analysis.json\n');

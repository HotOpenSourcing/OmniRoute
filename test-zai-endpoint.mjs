/**
 * Script de test pour l'endpoint Z.AI Coding Plan
 */

import { zaiCodingPlanProvider } from './open-sse/config/providers/registry/zai-coding-plan/index.ts';
import { ZAI_CODING_PLAN_CONFIG } from './src/lib/oauth/constants/oauth.ts';

console.log('🧪 Test du Provider Z.AI Coding Plan\n');
console.log('═'.repeat(60));

// Test 1: Configuration du provider
console.log('\n📋 Test 1: Configuration du Provider');
console.log('─'.repeat(60));
console.log('Provider ID:', zaiCodingPlanProvider.id);
console.log('Provider Alias:', zaiCodingPlanProvider.alias);
console.log('Format:', zaiCodingPlanProvider.format);
console.log('Base URL:', zaiCodingPlanProvider.baseUrl);
console.log('Auth Type:', zaiCodingPlanProvider.authType);
console.log('Auth Header:', zaiCodingPlanProvider.authHeader);
console.log('Executor:', zaiCodingPlanProvider.executor);

// Test 2: Configuration OAuth
console.log('\n🔐 Test 2: Configuration OAuth');
console.log('─'.repeat(60));
console.log('Client ID:', ZAI_CODING_PLAN_CONFIG.clientId);
console.log('Authorize URL:', ZAI_CODING_PLAN_CONFIG.authorizeUrl);
console.log('Token URL:', ZAI_CODING_PLAN_CONFIG.tokenUrl || 'N/A');
console.log('API Base:', ZAI_CODING_PLAN_CONFIG.apiBaseUrl || 'N/A');
console.log('Redirect URI:', ZAI_CODING_PLAN_CONFIG.redirectUri);
console.log('PKCE Method:', ZAI_CODING_PLAN_CONFIG.codeChallengeMethod || 'N/A');

// Test 3: Modèles disponibles
console.log('\n🤖 Test 3: Modèles Disponibles');
console.log('─'.repeat(60));
console.log(`Nombre de modèles: ${zaiCodingPlanProvider.models.length}\n`);

zaiCodingPlanProvider.models.forEach((model, index) => {
  console.log(`${index + 1}. ${model.name} (${model.id})`);
  console.log(`   Context: ${(model.contextWindow || 0).toLocaleString()} tokens`);
  console.log(`   Max Output: ${(model.maxOutputTokens || 0).toLocaleString()} tokens`);
  console.log(`   Reasoning: ${model.reasoning?.supportsReasoning ? '✅' : '❌'}`);
  if (model.kinds) console.log(`   Kinds: ${model.kinds.join(', ')}`);
  if (model.modalities) {
    console.log(`   Modalities: ${model.modalities.input.join(', ')} → ${model.modalities.output.join(', ')}`);
  }
  console.log('');
});

// Test 4: Test de connectivité
console.log('🌐 Test 4: Connectivité de l\'Endpoint');
console.log('─'.repeat(60));

const testUrls = [
  'https://zcode.z.ai/api/v1/',
  'https://chat.z.ai/',
];

for (const url of testUrls) {
  console.log(`\nTesting: ${url}`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    console.log(`  Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log('  ✅ Accessible');
    } else {
      console.log('  ⚠️ Erreur (normal sans authentification)');
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('  ⏱️ Timeout (5s)');
    } else {
      console.log('  ❌ Erreur:', error.message);
    }
  }
}

// Test 5: URL d'autorisation OAuth
console.log('\n🔗 Test 5: URL d\'Autorisation OAuth');
console.log('─'.repeat(60));

const testState = 'test_' + Math.random().toString(36).substring(7);
const params = new URLSearchParams({
  response_type: 'code',
  client_id: ZAI_CODING_PLAN_CONFIG.clientId,
  redirect_uri: ZAI_CODING_PLAN_CONFIG.redirectUri,
  state: testState,
});

const authUrl = `${ZAI_CODING_PLAN_CONFIG.authorizeUrl}?${params.toString()}`;
console.log('\nURL générée:');
console.log(authUrl);
console.log('\n💡 Vous pouvez tester cette URL dans un navigateur');

// Test 6: Headers requis
console.log('\n📤 Test 6: Headers Requis pour les Requêtes API');
console.log('─'.repeat(60));
console.log('Headers:');
if (zaiCodingPlanProvider.headers) {
  Object.entries(zaiCodingPlanProvider.headers).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
}
console.log(`  ${zaiCodingPlanProvider.authHeader}: Bearer <access_token>`);

// Résumé
console.log('\n' + '═'.repeat(60));
console.log('✅ Tests de configuration terminés\n');
console.log('📝 Prochaines étapes:');
console.log('1. npm run dev');
console.log('2. Ouvrir http://localhost:20128/dashboard');
console.log('3. Providers → Z.AI Coding Plan → Connect via OAuth');
console.log('4. Autoriser dans le navigateur');
console.log('5. Tester avec: curl http://localhost:20128/v1/chat/completions \\');
console.log('     -H "Authorization: Bearer YOUR_KEY" \\');
console.log('     -d \'{"model":"zai-coding-plan/glm-5.2","messages":[...]}\'');
console.log('═'.repeat(60));

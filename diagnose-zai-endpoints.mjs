/**
 * Script de diagnostic Z.AI Coding Plan
 * Teste différents endpoints et formats d'authentification
 */

const authCode = 'code-1b593be2d075';

console.log('🔍 Diagnostic Z.AI Coding Plan\n');
console.log('═'.repeat(70));

// Liste des endpoints possibles à tester
const endpoints = [
  {
    name: 'ZCode Plan Anthropic (actuel)',
    url: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authCode}`,
      'Anthropic-Version': '2023-06-01',
    }
  },
  {
    name: 'API Z.AI Standard',
    url: 'https://api.z.ai/api/paas/v4/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authCode}`,
    }
  },
  {
    name: 'API Coding PaaS',
    url: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authCode}`,
    }
  },
  {
    name: 'ZCode API v1',
    url: 'https://zcode.z.ai/api/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authCode}`,
    }
  },
];

const testPayload = {
  model: 'glm-5.2',
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 50,
};

console.log('\n📋 Token à tester:', authCode);
console.log('\n🧪 Test de', endpoints.length, 'endpoints...\n');

for (const endpoint of endpoints) {
  console.log('─'.repeat(70));
  console.log(`\n📡 ${endpoint.name}`);
  console.log('URL:', endpoint.url);

  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: endpoint.headers,
      body: JSON.stringify(testPayload),
    });

    const body = await response.text();

    console.log('Status:', response.status, response.statusText);

    if (response.ok) {
      console.log('✅ SUCCÈS!');
      console.log('Response:', body.substring(0, 200));
      console.log('\n🎉 ENDPOINT TROUVÉ!');
      break;
    } else if (response.status === 401) {
      console.log('❌ 401 Unauthorized');
    } else if (response.status === 404) {
      console.log('❌ 404 Not Found');
    } else if (response.status === 403) {
      console.log('❌ 403 Forbidden');
    } else {
      console.log('❌ Erreur:', response.status);
      console.log('Body:', body.substring(0, 200));
    }
  } catch (error) {
    console.log('❌ Erreur réseau:', error.message);
  }

  console.log('');
}

console.log('═'.repeat(70));
console.log('\n💡 Recommandations:');
console.log('─'.repeat(70));
console.log('1. Si tous les endpoints retournent 401:');
console.log('   → Le code OAuth n\'est peut-être pas utilisable directement');
console.log('   → Un échange supplémentaire pourrait être nécessaire');
console.log('');
console.log('2. Si un endpoint retourne 404:');
console.log('   → L\'endpoint n\'existe pas ou le modèle n\'est pas disponible');
console.log('');
console.log('3. Si un endpoint retourne 403:');
console.log('   → Le token est valide mais n\'a pas les permissions nécessaires');
console.log('');
console.log('4. Prochaine étape:');
console.log('   → Vérifier le vrai flow OAuth de ZCode dans le code source');
console.log('   → Le code-XXXXX pourrait nécessiter un échange JWT');
console.log('═'.repeat(70));

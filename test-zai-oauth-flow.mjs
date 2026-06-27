/**
 * Test complet du flow OAuth Z.AI Coding Plan avec code réel
 *
 * Ce script :
 * 1. Extrait le code OAuth de l'URL de callback
 * 2. Échange le code contre un access token
 * 3. Teste les 2 modèles disponibles (GLM-5.2 et GLM-5-Turbo)
 */

import { ZAI_CODING_PLAN_CONFIG } from './src/lib/oauth/constants/oauth.ts';
import { zaiCodingPlanProvider } from './open-sse/config/providers/registry/zai-coding-plan/index.ts';

console.log('🧪 Test Complet Z.AI Coding Plan avec OAuth\n');
console.log('═'.repeat(70));

// Extraction du code depuis l'URL de callback
const callbackUrl = 'zcode://zai-auth/callback?code=code-b4d54ad05eb0&state=82637db146e8027a55a3f1eb0c45808df3869c9c5eb01a3973c30bf7de1a1246';
const urlParams = new URLSearchParams(callbackUrl.split('?')[1]);
const authCode = urlParams.get('code');
const state = urlParams.get('state');

console.log('\n📋 Étape 1: Extraction du Code OAuth');
console.log('─'.repeat(70));
console.log('Authorization Code:', authCode);
console.log('State:', state);

// Échange du code contre un token
console.log('\n🔐 Étape 2: Échange du Code contre un Access Token');
console.log('─'.repeat(70));

let accessToken = null;
let tokenResponse = null;

try {
  console.log('Token URL:', ZAI_CODING_PLAN_CONFIG.tokenUrl || 'https://chat.z.ai/auth/oauth/token');
  console.log('Client ID:', ZAI_CODING_PLAN_CONFIG.clientId);
  console.log('Redirect URI:', ZAI_CODING_PLAN_CONFIG.redirectUri);

  const tokenUrl = ZAI_CODING_PLAN_CONFIG.tokenUrl || 'https://chat.z.ai/auth/oauth/token';

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ZAI_CODING_PLAN_CONFIG.clientId,
      code: authCode,
      redirect_uri: ZAI_CODING_PLAN_CONFIG.redirectUri,
    }),
  });

  console.log('\nRéponse du serveur:');
  console.log('Status:', response.status, response.statusText);

  const responseText = await response.text();
  console.log('Body:', responseText);

  if (response.ok) {
    tokenResponse = JSON.parse(responseText);
    accessToken = tokenResponse.access_token;
    console.log('\n✅ Token obtenu avec succès!');
    console.log('Access Token:', accessToken.substring(0, 20) + '...');
    if (tokenResponse.expires_in) {
      console.log('Expire dans:', tokenResponse.expires_in, 'secondes');
    }
    if (tokenResponse.refresh_token) {
      console.log('Refresh Token:', tokenResponse.refresh_token.substring(0, 20) + '...');
    }
  } else {
    console.log('\n❌ Erreur lors de l\'échange du token');
    console.log('Le code OAuth a peut-être expiré ou déjà été utilisé.');
    process.exit(1);
  }
} catch (error) {
  console.log('\n❌ Erreur de connexion:', error.message);
  process.exit(1);
}

// Test des modèles
console.log('\n🤖 Étape 3: Test des Modèles');
console.log('═'.repeat(70));

const testMessage = {
  role: 'user',
  content: 'Hello! Can you explain what is async/await in JavaScript in one sentence?'
};

for (const model of zaiCodingPlanProvider.models) {
  console.log(`\n📝 Test du modèle: ${model.name} (${model.id})`);
  console.log('─'.repeat(70));
  console.log(`Context Window: ${model.contextWindow?.toLocaleString() || 'N/A'} tokens`);
  console.log(`Max Output: ${model.maxOutputTokens?.toLocaleString() || 'N/A'} tokens`);
  console.log(`Reasoning: ${model.reasoning?.supportsReasoning ? '✅' : '❌'}`);

  try {
    const requestBody = {
      model: model.id,
      messages: [testMessage],
      max_tokens: 150,
    };

    console.log('\nEnvoi de la requête...');
    console.log('URL:', zaiCodingPlanProvider.baseUrl);
    console.log('Request:', JSON.stringify(requestBody, null, 2));

    const startTime = Date.now();

    const response = await fetch(zaiCodingPlanProvider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Anthropic-Version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    const duration = Date.now() - startTime;

    console.log(`\nRéponse (${duration}ms):`);
    console.log('Status:', response.status, response.statusText);

    const responseText = await response.text();

    if (response.ok) {
      const result = JSON.parse(responseText);
      console.log('\n✅ Succès!');
      console.log('Response ID:', result.id || 'N/A');
      console.log('Model:', result.model || 'N/A');

      if (result.content && result.content.length > 0) {
        console.log('\n📄 Réponse du modèle:');
        console.log('─'.repeat(70));
        result.content.forEach((content, index) => {
          if (content.type === 'text') {
            console.log(content.text);
          }
        });
        console.log('─'.repeat(70));
      }

      if (result.usage) {
        console.log('\n📊 Usage:');
        console.log('  Input tokens:', result.usage.input_tokens || 0);
        console.log('  Output tokens:', result.usage.output_tokens || 0);
        console.log('  Total tokens:', (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0));
      }

      console.log('\n✅ Modèle', model.name, 'fonctionne correctement!');
    } else {
      console.log('\n❌ Erreur:', response.status);
      console.log('Body:', responseText);
    }

  } catch (error) {
    console.log('\n❌ Erreur lors du test du modèle:', error.message);
  }

  // Pause entre les tests
  if (zaiCodingPlanProvider.models.indexOf(model) < zaiCodingPlanProvider.models.length - 1) {
    console.log('\n⏳ Pause de 2 secondes avant le prochain test...');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Résumé final
console.log('\n' + '═'.repeat(70));
console.log('✅ Tests terminés!');
console.log('\n💡 Pour utiliser via OmniRoute:');
console.log('1. Démarrer: npm run dev');
console.log('2. Dashboard: http://localhost:20128/dashboard');
console.log('3. Connecter Z.AI Coding Plan via OAuth');
console.log('4. Utiliser: curl http://localhost:20128/v1/chat/completions \\');
console.log('     -H "Authorization: Bearer YOUR_OMNIROUTE_KEY" \\');
console.log('     -d \'{"model":"zai-coding-plan/glm-5.2","messages":[...]}\'');
console.log('═'.repeat(70));

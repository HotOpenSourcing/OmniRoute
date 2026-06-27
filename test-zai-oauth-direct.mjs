/**
 * Test complet du flow OAuth Z.AI Coding Plan (flow non-standard)
 * 
 * IMPORTANT: Z.AI Coding Plan utilise un flow OAuth non-standard.
 * Le "code" retourné dans le callback est DIRECTEMENT utilisé comme Bearer token.
 * Il n'y a PAS d'échange de token via POST /token.
 * 
 * Ce script :
 * 1. Extrait le code OAuth de l'URL de callback
 * 2. Utilise le code DIRECTEMENT comme access token
 * 3. Teste les 2 modèles disponibles (GLM-5.2 et GLM-5-Turbo)
 */

import { ZAI_CODING_PLAN_CONFIG } from './src/lib/oauth/constants/oauth.ts';
import { zaiCodingPlanProvider } from './open-sse/config/providers/registry/zai-coding-plan/index.ts';

console.log('🧪 Test Complet Z.AI Coding Plan avec OAuth (Flow Non-Standard)\n');
console.log('═'.repeat(70));

// Extraction du code depuis l'URL de callback
const callbackUrl = 'zcode://zai-auth/callback?code=code-1b593be2d075&state=aef596aa837c015f6b79512cc9246c3f6d6f189ec1a9310c49ac0afd3c4974cd';
const urlParams = new URLSearchParams(callbackUrl.split('?')[1]);
const authCode = urlParams.get('code');
const state = urlParams.get('state');

console.log('\n📋 Étape 1: Extraction du Code OAuth');
console.log('─'.repeat(70));
console.log('Authorization Code:', authCode);
console.log('State:', state);

console.log('\n💡 Info: Flow Non-Standard');
console.log('─'.repeat(70));
console.log('Z.AI Coding Plan utilise un flow OAuth simplifié:');
console.log('• Le "code" retourné est DIRECTEMENT le Bearer token');
console.log('• Pas de POST /token pour échanger le code');
console.log('• Le code est valide jusqu\'à expiration (durée non documentée)');

// Utilisation directe du code comme access token
const accessToken = authCode;

console.log('\n✅ Token prêt à l\'emploi:');
console.log('Access Token:', accessToken);

// Test des modèles
console.log('\n🤖 Étape 2: Test des Modèles');
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
      temperature: 0.7,
    };
    
    console.log('\nEnvoi de la requête...');
    console.log('URL:', zaiCodingPlanProvider.baseUrl);
    console.log('Model:', model.id);
    console.log('Authorization: Bearer', accessToken.substring(0, 20) + '...');
    
    const startTime = Date.now();
    
    const response = await fetch(zaiCodingPlanProvider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Anthropic-Version': '2023-06-01',
        'Accept': 'application/json',
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
        result.content.forEach((content) => {
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
      console.log('Headers:', Object.fromEntries(response.headers));
      console.log('Body:', responseText.substring(0, 500));
      
      if (response.status === 401) {
        console.log('\n⚠️ Le token a peut-être expiré. Générez un nouveau code OAuth.');
      } else if (response.status === 404) {
        console.log('\n⚠️ L\'endpoint ou le modèle n\'existe pas.');
      }
    }
    
  } catch (error) {
    console.log('\n❌ Erreur lors du test du modèle:', error.message);
    console.log('Stack:', error.stack);
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
console.log('3. Providers → Z.AI Coding Plan → "Manual Token"');
console.log('4. Coller le code OAuth comme token:', accessToken);
console.log('5. Utiliser: curl http://localhost:20128/v1/chat/completions \\');
console.log('     -H "Authorization: Bearer YOUR_OMNIROUTE_KEY" \\');
console.log('     -d \'{"model":"zai-coding-plan/glm-5.2","messages":[...]}\'');
console.log('\n📝 Note: Le code OAuth expire après un certain temps.');
console.log('   Si vous obtenez 401, régénérez un nouveau code via:');
console.log('   https://chat.z.ai/auth/oauth/authorize?...');
console.log('═'.repeat(70));

/**
 * Test systématique de tous les endpoints OAuth possibles pour Z.AI Coding Plan
 * Code OAuth reçu: code-ff102b4e10dd
 * State: test123
 */

const authCode = 'code-ff102b4e10dd';
const state = 'test123';
const clientId = 'client_P8X5CMWmlaRO9gyO-KSqtg';
const redirectUri = 'zcode://zai-auth/callback';
const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

console.log('🔍 Test systématique des endpoints OAuth Z.AI\n');
console.log('═'.repeat(70));
console.log('Code:', authCode);
console.log('State:', state);
console.log('Client ID:', clientId);
console.log('═'.repeat(70));

// Liste de tous les endpoints à tester
const tests = [
  {
    name: 'CLI Poll avec state',
    method: 'GET',
    url: `https://zcode.z.ai/api/v1/oauth/cli/poll/${state}`,
    headers: {
      'Authorization': `Bearer ${authCode}`,
      'Accept': 'application/json',
    },
  },
  {
    name: 'CLI Poll avec code',
    method: 'GET',
    url: `https://zcode.z.ai/api/v1/oauth/cli/poll/${authCode}`,
    headers: {
      'Accept': 'application/json',
    },
  },
  {
    name: 'CLI Poll sans prefix code-',
    method: 'GET',
    url: `https://zcode.z.ai/api/v1/oauth/cli/poll/${authCode.replace('code-', '')}`,
    headers: {
      'Accept': 'application/json',
    },
  },
  {
    name: 'Token exchange standard (zcode.z.ai)',
    method: 'POST',
    url: 'https://zcode.z.ai/api/v1/oauth/token',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    },
  },
  {
    name: 'Token exchange standard (chat.z.ai)',
    method: 'POST',
    url: 'https://chat.z.ai/api/v1/oauth/token',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    },
  },
  {
    name: 'Token exchange (chat.z.ai/auth/oauth/token)',
    method: 'POST',
    url: 'https://chat.z.ai/auth/oauth/token',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
    bodyIsString: true,
  },
  {
    name: 'CLI Exchange endpoint',
    method: 'POST',
    url: 'https://zcode.z.ai/api/v1/oauth/cli/exchange',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      code: authCode,
      state: state,
      client_id: clientId,
    },
  },
  {
    name: 'Direct API call avec code comme Bearer',
    method: 'POST',
    url: 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authCode}`,
      'Anthropic-Version': '2023-06-01',
    },
    body: {
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5,
    },
  },
];

// Exécuter tous les tests
for (const test of tests) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📝 Test: ${test.name}`);
  console.log(`   Method: ${test.method} ${test.url}`);

  try {
    const options = {
      method: test.method,
      headers: test.headers,
    };

    if (test.body) {
      options.body = test.bodyIsString ? test.body : JSON.stringify(test.body);
    }

    const response = await fetch(test.url, options);
    const contentType = response.headers.get('content-type');

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${contentType}`);

    if (response.ok) {
      console.log('   ✅ SUCCÈS!');
      const text = await response.text();
      
      if (contentType && contentType.includes('application/json')) {
        const data = JSON.parse(text);
        console.log('   Response:', JSON.stringify(data, null, 2).substring(0, 500));
        
        // Vérifier si on a un token JWT
        if (data.access_token || data.token || (data.data && data.data.token)) {
          console.log('\n🎉🎉🎉 TOKEN TROUVÉ! 🎉🎉🎉');
          console.log('Token:', data.access_token || data.token || data.data.token);
          
          // Sauvegarder le token pour tests ultérieurs
          console.log('\n💾 Token sauvegardé pour tests ultérieurs');
        }
      } else {
        console.log('   Response:', text.substring(0, 300));
      }
    } else {
      const errorText = await response.text();
      console.log(`   ❌ Échec`);
      if (errorText && errorText.length > 0 && errorText.length < 500) {
        console.log(`   Error: ${errorText}`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Erreur: ${error.message}`);
  }
}

console.log(`\n${'═'.repeat(70)}`);
console.log('✅ Tests terminés');

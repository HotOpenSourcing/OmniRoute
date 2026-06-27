/**
 * Test de variations de paramètres pour /oauth/token
 * L'endpoint existe mais retourne "parameter error"
 */

const authCode = 'code-ff102b4e10dd';
const state = 'test123';
const clientId = 'client_P8X5CMWmlaRO9gyO-KSqtg';
const redirectUri = 'zcode://zai-auth/callback';
const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

console.log('🔍 Test de variations de paramètres pour /oauth/token\n');
console.log('═'.repeat(70));

// Variations de paramètres à tester
const paramVariations = [
  {
    name: 'Paramètres minimaux',
    body: {
      code: authCode,
      client_id: clientId,
    },
  },
  {
    name: 'Avec grant_type seulement',
    body: {
      grant_type: 'authorization_code',
      code: authCode,
    },
  },
  {
    name: 'Code sans prefix + grant_type',
    body: {
      grant_type: 'authorization_code',
      code: authCode.replace('code-', ''),
      client_id: clientId,
    },
  },
  {
    name: 'Avec tous les paramètres OAuth standard',
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    },
  },
  {
    name: 'Avec state au lieu de code_verifier',
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      state: state,
    },
  },
  {
    name: 'Avec code_challenge au lieu de code_verifier',
    body: {
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    },
  },
  {
    name: 'Format form-urlencoded',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
    contentType: 'application/x-www-form-urlencoded',
    isFormData: true,
  },
  {
    name: 'Authorization code dans le code (sans prefix)',
    body: {
      authorization_code: authCode.replace('code-', ''),
      client_id: clientId,
    },
  },
  {
    name: 'Juste le code (sans prefix)',
    body: {
      code: authCode.replace('code-', ''),
    },
  },
  {
    name: 'Avec flow_id (code comme flow_id)',
    body: {
      flow_id: authCode,
      client_id: clientId,
    },
  },
];

const baseUrl = 'https://zcode.z.ai/api/v1/oauth/token';

for (const variation of paramVariations) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📝 Test: ${variation.name}`);

  try {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': variation.contentType || 'application/json',
      },
      body: variation.isFormData ? variation.body : JSON.stringify(variation.body),
    };

    const response = await fetch(baseUrl, options);
    const contentType = response.headers.get('content-type');

    console.log(`   Status: ${response.status} ${response.statusText}`);

    if (response.ok) {
      console.log('   ✅ SUCCÈS!');
      const text = await response.text();
      
      if (contentType && contentType.includes('application/json')) {
        const data = JSON.parse(text);
        console.log('   Response:', JSON.stringify(data, null, 2));
        
        if (data.access_token || data.token) {
          console.log('\n🎉🎉🎉 TOKEN TROUVÉ! 🎉🎉🎉');
          console.log('Access Token:', data.access_token || data.token);
          
          // Test immédiat avec le token
          console.log('\n🧪 Test du token sur l\'API...');
          const testResponse = await fetch(
            'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${data.access_token || data.token}`,
                'Anthropic-Version': '2023-06-01',
              },
              body: JSON.stringify({
                model: 'glm-5.2',
                messages: [{ role: 'user', content: 'Hello' }],
                max_tokens: 5,
              }),
            }
          );
          
          console.log(`   API Test Status: ${testResponse.status}`);
          if (testResponse.ok) {
            console.log('   ✅ Le token fonctionne sur l\'API!');
          }
        }
      } else {
        console.log('   Response:', text.substring(0, 300));
      }
    } else {
      const errorText = await response.text();
      if (errorText && errorText.length > 0 && errorText.length < 200) {
        console.log(`   ❌ Error: ${errorText}`);
      } else {
        console.log(`   ❌ Échec`);
      }
    }
  } catch (error) {
    console.log(`   ❌ Erreur: ${error.message}`);
  }
}

console.log(`\n${'═'.repeat(70)}`);
console.log('✅ Tests terminés');

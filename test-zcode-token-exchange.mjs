/**
 * Test d'échange de code OAuth via endpoint /oauth/token standard
 */

const authCode = 'code-1b593be2d075';
const clientId = 'client_P8X5CMWmlaRO9gyO-KSqtg';
const redirectUri = 'zcode://zai-auth/callback';

console.log('🔍 Test d\'échange de code OAuth via /oauth/token\n');
console.log('═'.repeat(70));
console.log('Code:', authCode);
console.log('Client ID:', clientId);
console.log('Redirect URI:', redirectUri);
console.log('');

// Endpoints possibles pour l'échange
const endpoints = [
  'https://zcode.z.ai/api/v1/oauth/token',
  'https://chat.z.ai/auth/oauth/token',
  'https://api.z.ai/oauth/token',
];

for (const endpoint of endpoints) {
  console.log(`\n🧪 Test: ${endpoint}`);
  console.log('─'.repeat(70));
  
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      client_id: clientId,
      redirect_uri: redirectUri,
    });
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });
    
    console.log('Status:', response.status, response.statusText);
    
    const responseBody = await response.text();
    console.log('Body:', responseBody);
    
    if (response.ok) {
      console.log('\n✅ SUCCÈS! Token obtenu');
      const data = JSON.parse(responseBody);
      console.log('Access Token:', data.access_token?.substring(0, 50) + '...');
      break;
    }
  } catch (error) {
    console.log('❌ Erreur réseau:', error.message);
  }
}

console.log('\n' + '═'.repeat(70));
console.log('📝 Résultat:');
console.log('Si aucun endpoint ne fonctionne, Z.AI Coding Plan pourrait:');
console.log('1. Nécessiter un flow CLI complet (non compatible avec OAuth standard)');
console.log('2. Nécessiter une subscription/API key séparée');
console.log('3. Ne pas supporter le flow de redirection pour les apps externes');
console.log('═'.repeat(70));

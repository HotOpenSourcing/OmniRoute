/**
 * Test du vrai flow OAuth CLI de ZCode
 * D'après le rapport technique, ZCode utilise un flow de polling:
 * 1. POST /oauth/cli/init
 * 2. GET /oauth/cli/poll/{flow_id}
 */

const authCode = 'code-1b593be2d075';
const baseUrl = 'https://zcode.z.ai/api/v1';

console.log('🔍 Test du Flow OAuth CLI ZCode\n');
console.log('═'.repeat(70));
console.log('\n📋 Code OAuth reçu:', authCode);
console.log('Base URL:', baseUrl);

// Le code que vous avez reçu pourrait être un flow_id ou un token final
// Essayons de vérifier s'il peut être utilisé avec l'API CLI

console.log('\n🧪 Tentative 1: Utiliser le code comme token JWT');
console.log('─'.repeat(70));

try {
  const testUrl = 'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages';

  // Essayons avec différents formats de header
  const authFormats = [
    { name: 'Bearer code-XXX', value: `Bearer ${authCode}` },
    { name: 'Bearer sans prefix', value: `Bearer ${authCode.replace('code-', '')}` },
    { name: 'Code direct', value: authCode },
    { name: 'JWT format', value: `JWT ${authCode}` },
  ];

  for (const format of authFormats) {
    console.log(`\nTest: ${format.name}`);
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': format.value,
        'Anthropic-Version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'glm-5.2',
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 10,
      }),
    });

    console.log('  Status:', response.status);

    if (response.ok) {
      console.log('  ✅ SUCCÈS!');
      const body = await response.text();
      console.log('  Response:', body.substring(0, 200));
      break;
    }
  }
} catch (error) {
  console.log('  ❌ Erreur:', error.message);
}

console.log('\n🧪 Tentative 2: Vérifier si le code peut être échangé');
console.log('─'.repeat(70));

// D'après le rapport, ZCode utilise un pollToken de 32 octets hex
// Le code OAuth reçu pourrait nécessiter un échange avec ce pollToken

try {
  console.log('\nTest: Échange via /oauth/cli/poll');

  // Le flow_id est peut-être extrait du state ou généré
  const state = 'aef596aa837c015f6b79512cc9246c3f6d6f189ec1a9310c49ac0afd3c4974cd';

  // Essayons de poller avec le state comme flow_id
  const pollUrl = `${baseUrl}/oauth/cli/poll/${state}`;

  console.log('URL:', pollUrl);
  console.log('Authorization:', authCode);

  const response = await fetch(pollUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${authCode}`,
      'Accept': 'application/json',
    },
  });

  console.log('Status:', response.status);
  const body = await response.text();
  console.log('Body:', body.substring(0, 500));

  if (response.ok) {
    const data = JSON.parse(body);
    console.log('\n✅ Réponse du serveur:');
    console.log(JSON.stringify(data, null, 2));

    if (data.data && data.data.token) {
      console.log('\n🎉 TOKEN JWT TROUVÉ!');
      console.log('JWT Token:', data.data.token);
    }
  }
} catch (error) {
  console.log('❌ Erreur:', error.message);
}

console.log('\n' + '═'.repeat(70));
console.log('📝 Conclusion:');
console.log('─'.repeat(70));
console.log('Le flow OAuth de Z.AI Coding Plan semble nécessiter:');
console.log('1. Un flow d\'initialisation CLI (/oauth/cli/init)');
console.log('2. Un polling pour obtenir le vrai JWT token');
console.log('3. Le code-XXXXX reçu dans le callback n\'est pas le token final');
console.log('');
console.log('💡 Recommandation:');
console.log('Pour OmniRoute, il faudrait implémenter le flow CLI complet:');
console.log('• Générer un pollToken (32 bytes hex)');
console.log('• POST /oauth/cli/init avec provider="zai"');
console.log('• Rediriger vers authorize_url');
console.log('• Poller /oauth/cli/poll/{flow_id} jusqu\'à obtenir le JWT');
console.log('═'.repeat(70));

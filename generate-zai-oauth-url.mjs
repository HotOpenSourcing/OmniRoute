/**
 * Générateur d'URL d'autorisation OAuth Z.AI Coding Plan
 * 
 * Ce script génère une URL d'autorisation que vous pouvez ouvrir dans un navigateur
 * pour obtenir un nouveau code OAuth valide.
 */

import { ZAI_CODING_PLAN_CONFIG } from './src/lib/oauth/constants/oauth.ts';
import crypto from 'crypto';

console.log('🔗 Générateur d\'URL OAuth Z.AI Coding Plan\n');
console.log('═'.repeat(70));

// Génération d'un state aléatoire sécurisé (pour CSRF protection)
const state = crypto.randomBytes(32).toString('hex');

// Construction de l'URL d'autorisation
const params = new URLSearchParams({
  response_type: 'code',
  client_id: ZAI_CODING_PLAN_CONFIG.clientId,
  redirect_uri: ZAI_CODING_PLAN_CONFIG.redirectUri,
  state: state,
});

const authUrl = `${ZAI_CODING_PLAN_CONFIG.authorizeUrl}?${params.toString()}`;

console.log('\n📋 Paramètres OAuth:');
console.log('─'.repeat(70));
console.log('Client ID:', ZAI_CODING_PLAN_CONFIG.clientId);
console.log('Authorize URL:', ZAI_CODING_PLAN_CONFIG.authorizeUrl);
console.log('Redirect URI:', ZAI_CODING_PLAN_CONFIG.redirectUri);
console.log('State (CSRF):', state);

console.log('\n🔗 URL d\'autorisation:');
console.log('─'.repeat(70));
console.log(authUrl);

console.log('\n📝 Instructions:');
console.log('─'.repeat(70));
console.log('1. Copiez l\'URL ci-dessus');
console.log('2. Ouvrez-la dans un navigateur');
console.log('3. Autorisez l\'application');
console.log('4. Vous serez redirigé vers une URL commençant par:');
console.log('   zcode://zai-auth/callback?code=code-XXXXXXXX&state=...');
console.log('5. Copiez TOUTE l\'URL de redirection');
console.log('6. Utilisez-la avec le script de test:');
console.log('   • Modifiez test-zai-oauth-direct.mjs');
console.log('   • Remplacez la valeur de callbackUrl');
console.log('   • Relancez: node --import tsx/esm test-zai-oauth-direct.mjs');

console.log('\n⚠️ Important:');
console.log('─'.repeat(70));
console.log('• Le code OAuth est à usage unique');
console.log('• Il expire après quelques minutes');
console.log('• Utilisez-le immédiatement après l\'avoir généré');
console.log('• Si vous obtenez 401, régénérez un nouveau code');

console.log('\n💡 Alternative: Utiliser OmniRoute Dashboard');
console.log('─'.repeat(70));
console.log('1. npm run dev');
console.log('2. http://localhost:20128/dashboard');
console.log('3. Providers → Z.AI Coding Plan → Connect via OAuth');
console.log('4. Le dashboard gèrera automatiquement le flow OAuth');
console.log('═'.repeat(70));

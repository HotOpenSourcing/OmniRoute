// Test complet avec trace détaillée pour identifier où se produit l'erreur "session error: 200"
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';

import { createHttpClient } from './src/lib/providers/freebuff/cliEmulator/httpClient.ts';
import { createSessionManager, FREEBUFF_BASE_URL } from './src/lib/providers/freebuff/cliEmulator/sessionManager.ts';
import { createAgentRunner } from './src/lib/providers/freebuff/cliEmulator/agentRunner.ts';
import { buildEnvelope, buildHeaders, generateClientId, generateUserInputId } from './src/lib/providers/freebuff/cliEmulator/envelopeBuilder.ts';
import { getModelDescriptor } from './src/lib/providers/freebuff/cliEmulator/modelRegistry.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

const MODEL = 'deepseek/deepseek-v4-flash';
const BASE = FREEBUFF_BASE_URL.replace(/\/$/, '');

async function run() {
  console.log('=== ÉTAPE 1: Session Claim ===');
  const httpClient = await createHttpClient();
  const sessionManager = createSessionManager(httpClient, FREEBUFF_BASE_URL);
  
  const session = await sessionManager.claim({
    authToken: credentials.authToken,
    modelId: MODEL,
  });
  console.log('✅ Session claimed:', session.instanceId);
  console.log('   Tier:', session.accessTier);
  console.log('   Expires:', session.expiresAt);

  console.log('\n=== ÉTAPE 2: Agent Run START ===');
  const agentRunner = createAgentRunner(httpClient, BASE);
  const modelDesc = getModelDescriptor(MODEL);
  
  const agentRun = await agentRunner.start({
    authToken: credentials.authToken,
    agent: modelDesc.agent,
    model: MODEL,
    fingerprintId: credentials.fingerprintId,
    fingerprintHash: credentials.fingerprintHash,
    instanceId: session.instanceId,
  });
  console.log('✅ Agent run started:', agentRun.runId);

  console.log('\n=== ÉTAPE 3: Build Envelope ===');
  const clientId = generateClientId();
  const userInputId = generateUserInputId();
  const envelope = buildEnvelope({
    input: {
      model: MODEL,
      messages: [{ role: 'user', content: 'Say hello in 3 words only' }],
      stream: true
    },
    credentials,
    session,
    runId: agentRun.runId,
    agent: modelDesc.agent,
    clientId,
    userInputId,
  });
  console.log('✅ Envelope built');
  console.log('   Keys:', Object.keys(envelope).join(', '));
  console.log('   runId:', envelope.runId);
  console.log('   model:', envelope.model);

  console.log('\n=== ÉTAPE 4: POST Chat Completions ===');
  const headers = buildHeaders(credentials, session, MODEL);
  const upstream = await httpClient.fetch({
    url: `${BASE}/api/v1/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });

  console.log('Response status:', upstream.status);
  console.log('Response ok:', upstream.ok);
  console.log('Response statusText:', upstream.statusText);

  if (!upstream.ok) {
    const errBody = await upstream.text();
    console.error('\n❌ Chat completions FAILED!');
    console.error('Body:', errBody.slice(0, 500));
    process.exit(1);
  }

  console.log('\n✅ SUCCESS! SSE stream first 1500 bytes:');
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  
  while (total < 1500) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('\n[stream ended]');
      break;
    }
    const text = decoder.decode(value, { stream: true });
    process.stdout.write(text);
    total += text.length;
  }
  
  if (total >= 1500) {
    reader.cancel();
    console.log('\n[truncated]');
  }
  
  console.log(`\n\nTotal bytes: ${total}`);
  console.log('\n✅ ALL TESTS PASSED!');
}

run().catch(err => {
  console.error('\n❌ FATAL ERROR:');
  console.error('Name:', err.constructor.name);
  console.error('Message:', err.message);
  if (err.stack) console.error('Stack:', err.stack);
  process.exit(1);
});

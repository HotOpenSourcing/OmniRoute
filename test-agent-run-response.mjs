// Test pour voir la réponse brute de agent-run START
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';

import { createHttpClient } from './src/lib/providers/freebuff/cliEmulator/httpClient.ts';
import { createSessionManager, FREEBUFF_BASE_URL } from './src/lib/providers/freebuff/cliEmulator/sessionManager.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

const MODEL = 'deepseek/deepseek-v4-flash';
const AGENT_ID = 'base2-free-deepseek-flash';
const BASE = FREEBUFF_BASE_URL.replace(/\/$/, '');

async function run() {
  const httpClient = await createHttpClient();
  const sessionManager = createSessionManager(httpClient, FREEBUFF_BASE_URL);

  console.log('Step 1: Session claim...');
  const session = await sessionManager.claim({
    authToken: credentials.authToken,
    modelId: MODEL,
  });
  console.log('✅ Session:', session.instanceId);

  console.log('\nStep 2: Agent-run START (raw)...');
  const response = await httpClient.fetch({
    url: `${BASE}/api/v1/agent-runs`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.authToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'user-agent': 'ai-sdk/openai-compatible/1.0.0/codebuff',
      'x-codebuff-fingerprint': credentials.fingerprintId,
      'x-codebuff-fingerprint-hash': credentials.fingerprintHash,
      'x-freebuff-instance-id': session.instanceId,
    },
    body: JSON.stringify({
      action: 'START',
      agentId: AGENT_ID,
      model: MODEL,
      fingerprintId: credentials.fingerprintId,
      fingerprintHash: credentials.fingerprintHash,
      freebuffInstanceId: session.instanceId,
    }),
  });

  console.log('Status:', response.status);
  console.log('OK:', response.ok);

  const bodyText = await response.text();
  console.log('\nRaw body:');
  console.log(bodyText);

  console.log('\nParsed JSON:');
  try {
    const parsed = JSON.parse(bodyText);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.error('Failed to parse:', e.message);
  }
}

run().catch(err => {
  console.error('ERROR:', err.message);
  if (err.stack) console.error(err.stack);
});

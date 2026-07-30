// Full emulateChat test via createAgentRunner (with agentId fix already applied to agentRunner.ts)
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.FREEBUFF_DEBUG = '1';

import { createHttpClient } from './src/lib/providers/freebuff/cliEmulator/httpClient.ts';
import { createSessionManager, FREEBUFF_BASE_URL } from './src/lib/providers/freebuff/cliEmulator/sessionManager.ts';
import { buildEnvelope, buildHeaders, generateClientId, generateUserInputId } from './src/lib/providers/freebuff/cliEmulator/envelopeBuilder.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

const MODEL = 'deepseek/deepseek-v4-flash';
// Correct agent from modelRegistry.ts line 74
const AGENT_ID = 'base2-free-deepseek-flash';
const BASE = FREEBUFF_BASE_URL.replace(/\/$/, '');

async function run() {
  const httpClient = await createHttpClient();
  const sessionManager = createSessionManager(httpClient, FREEBUFF_BASE_URL);

  // Step 1: Claim session
  console.log('\n--- Step 1: Claim session ---');
  const session = await sessionManager.claim({
    authToken: credentials.authToken,
    modelId: MODEL,
  });
  console.log('Session instanceId:', session.instanceId);
  console.log('Session tier:', session.accessTier);

  // Step 2: Start agent run with correct agentId
  console.log('\n--- Step 2: agent-run START (agentId=' + AGENT_ID + ') ---');
  const agentRunResp = await httpClient.fetch({
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

  const agentRunBody = await agentRunResp.text();
  console.log('agent-run status:', agentRunResp.status, '| ok:', agentRunResp.ok);
  console.log('agent-run body:', agentRunBody);

  if (!agentRunResp.ok) {
    console.error('FAILED at agent-run START');
    return;
  }

  const agentRun = JSON.parse(agentRunBody);
  const runId = agentRun.runId;
  console.log('runId:', runId);

  // Step 3: PostChat
  console.log('\n--- Step 3: PostChat ---');
  const clientId = generateClientId();
  const userInputId = generateUserInputId();
  const envelope = buildEnvelope({
    input: { model: MODEL, messages: [{ role: 'user', content: 'Say hello in 3 words only' }], stream: true },
    credentials,
    session,
    runId,
    agent: AGENT_ID,
    clientId,
    userInputId,
  });
  const headers = buildHeaders(credentials, session, MODEL);

  console.log('Envelope keys:', Object.keys(envelope).join(', '));

  const upstream = await httpClient.fetch({
    url: `${BASE}/api/v1/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });

  console.log('postChat status:', upstream.status, '| ok:', upstream.ok);
  if (!upstream.ok) {
    const errBody = await upstream.text();
    console.log('postChat error:', errBody);
  } else {
    console.log('SUCCESS! SSE stream first 1500 bytes:');
    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let total = 0;
    while (total < 1500) {
      const { done, value } = await reader.read();
      if (done) { console.log('[stream ended]'); break; }
      const chunk = dec.decode(value);
      process.stdout.write(chunk);
      total += chunk.length;
    }
    reader.cancel();
    console.log('\n[truncated]');
  }
}

run().catch(err => {
  console.error('FATAL:', err.message);
  if (err.stack) console.error(err.stack);
});

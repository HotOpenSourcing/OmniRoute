// Test different TLS identifiers to bypass free_mode_cli_required
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';

import { FREEBUFF_BASE_URL } from './src/lib/providers/freebuff/cliEmulator/sessionManager.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

const IDENTIFIERS_TO_TEST = [
  'bun_0.1.0',      // current
  'bun_1.0.0',
  'bun_1.1.0',
  'chrome_120',
  'chrome_124',
  'firefox_120',
  'safari_ios_16.5',
  'okhttp4_android_13',
];

async function testIdentifier(identifier) {
  try {
    const mod = await import('tls-client-node');
    const proxyUrl = process.env.RESIDENTIAL_PROXY;
    
    const response = await mod.fetch(`${FREEBUFF_BASE_URL}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.authToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        'user-agent': 'ai-sdk/openai-compatible/1.0.0/codebuff',
        'x-codebuff-fingerprint': credentials.fingerprintId,
        'x-codebuff-fingerprint-hash': credentials.fingerprintHash,
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
      }),
      clientIdentifier: identifier,
      ...(proxyUrl ? { proxyUrl } : {}),
    });

    const status = response.status;
    const bodyText = typeof response.body === 'string' 
      ? response.body 
      : new TextDecoder().decode(response.body);
    
    const shortBody = bodyText.slice(0, 150);
    const isCLIRequired = shortBody.includes('free_mode_cli_required');
    
    return {
      identifier,
      status,
      ok: status >= 200 && status < 300,
      cliRequired: isCLIRequired,
      body: shortBody
    };
  } catch (err) {
    return {
      identifier,
      error: err.message
    };
  }
}

async function run() {
  console.log('Testing TLS client identifiers against Freebuff backend...\n');
  
  for (const identifier of IDENTIFIERS_TO_TEST) {
    const result = await testIdentifier(identifier);
    
    if (result.error) {
      console.log(`❌ ${identifier}: ERROR - ${result.error}`);
    } else if (result.ok && !result.cliRequired) {
      console.log(`✅ ${identifier}: SUCCESS (${result.status}) - NOT BLOCKED`);
      console.log(`   Body preview: ${result.body.replace(/\n/g, ' ')}`);
      break; // Found a working identifier
    } else if (result.cliRequired) {
      console.log(`⛔ ${identifier}: BLOCKED (${result.status}) - free_mode_cli_required`);
    } else {
      console.log(`⚠️  ${identifier}: ${result.status} - ${result.body.slice(0, 80)}`);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

run().catch(err => console.error('FATAL:', err.message));

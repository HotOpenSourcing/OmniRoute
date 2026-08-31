// Test complet end-to-end de emulateChat() après tous les correctifs
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.FREEBUFF_DEBUG = '1';

import { emulateChat } from './src/lib/providers/freebuff/cliEmulator/index.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

async function run() {
  console.log('=== Test complet emulateChat() ===\n');
  console.log('Model: deepseek/deepseek-v4-flash');
  console.log('Messages: [{ role: "user", content: "Say hello in 3 words only" }]\n');

  try {
    const result = await emulateChat({
      model: 'deepseek/deepseek-v4-flash',
      messages: [{ role: 'user', content: 'Say hello in 3 words only' }],
      stream: true
    }, {
      credentials,
      format: 'openai'
    });

    console.log('✅ emulateChat SUCCESS!\n');
    console.log('Response headers:');
    console.log('  Status:', result.response.status);
    console.log('  Content-Type:', result.response.headers.get('content-type'));
    console.log('  x-omniroute-freebuff-run-id:', result.response.headers.get('x-omniroute-freebuff-run-id'));
    console.log('  x-omniroute-freebuff-instance:', result.response.headers.get('x-omniroute-freebuff-instance'));
    console.log('  x-omniroute-freebuff-tier:', result.response.headers.get('x-omniroute-freebuff-tier'));
    console.log('  x-omniroute-freebuff-model:', result.response.headers.get('x-omniroute-freebuff-model'));
    console.log('\nMetadata:');
    console.log('  Served Model:', result.servedModel);
    console.log('  Served Tier:', result.servedTier);
    console.log('  Run ID:', result.runId);
    console.log('  Instance ID:', result.instanceId);
    console.log('  Fallback Attempts:', result.fallbackAttempts);

    console.log('\n--- SSE Stream (first 2000 bytes) ---');
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let chunkCount = 0;
    
    while (total < 2000) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('\n[stream ended naturally]');
        break;
      }
      const text = decoder.decode(value, { stream: true });
      process.stdout.write(text);
      total += text.length;
      chunkCount++;
    }
    
    if (total >= 2000) {
      reader.cancel();
      console.log('\n[truncated after 2000 bytes]');
    }
    
    console.log(`\nTotal chunks: ${chunkCount}, Total bytes: ${total}`);
    console.log('\n✅ Test PASSED!');

  } catch (err) {
    console.error('\n❌ Test FAILED!');
    console.error('Error:', err.message);
    
    if (err.attempts) {
      console.error('\nFallback attempts:');
      for (const attempt of err.attempts) {
        console.error(`  - ${attempt.model} (${attempt.tier}): ${attempt.error}`);
      }
    }
    
    if (err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }
    
    process.exit(1);
  }
}

run();

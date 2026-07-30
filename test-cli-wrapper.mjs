// Test du CLI wrapper (vrai binaire Freebuff)
import { invokeFreebuffCli, isFreebuffCliInstalled, getFreebuffBinaryPath } from './src/lib/providers/freebuff/cliWrapper.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
  fingerprintId: 'enhanced-0SXVprLnIDmnBvUtjS-FX-akZZfb85A21MOZkA5MX6A',
  fingerprintHash: '71aa7fb4b62883451bf5441852508545639250b1b70f2f64d2596b600a332461'
};

async function run() {
  console.log('=== Test CLI Wrapper (vrai binaire Freebuff) ===\n');
  
  const binaryPath = getFreebuffBinaryPath();
  console.log('Binary path:', binaryPath);
  
  const isInstalled = isFreebuffCliInstalled();
  console.log('Is installed:', isInstalled);
  
  if (!isInstalled) {
    console.error('\n❌ Freebuff CLI not installed!');
    console.error('Install with: npm i -g freebuff');
    process.exit(1);
  }
  
  console.log('\nInvoking CLI with:');
  console.log('  Model: deepseek/deepseek-v4-flash');
  console.log('  Message: Say hello in 3 words only\n');
  
  try {
    const stream = await invokeFreebuffCli(
      {
        model: 'deepseek/deepseek-v4-flash',
        messages: [{ role: 'user', content: 'Say hello in 3 words only' }],
        stream: true
      },
      credentials
    );
    
    console.log('✅ Stream created! Reading first 2000 bytes...\n');
    
    const reader = stream.getReader();
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
    
    console.log(`\n\nTotal chunks: ${chunkCount}, Total bytes: ${total}`);
    console.log('\n✅ CLI WRAPPER TEST PASSED!');
    
  } catch (err) {
    console.error('\n❌ CLI WRAPPER TEST FAILED!');
    console.error('Error:', err.message);
    if (err.stack) console.error('Stack:', err.stack);
    process.exit(1);
  }
}

run();

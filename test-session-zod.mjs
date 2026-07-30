// Test session claim with full Zod error details
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';

import { createHttpClient } from './src/lib/providers/freebuff/cliEmulator/httpClient.ts';
import { createSessionManager, FREEBUFF_BASE_URL } from './src/lib/providers/freebuff/cliEmulator/sessionManager.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
};

const MODEL = 'deepseek/deepseek-v4-flash';

async function run() {
  const httpClient = await createHttpClient();
  const sessionManager = createSessionManager(httpClient, FREEBUFF_BASE_URL);

  console.log('Calling sessionManager.claim()...\n');
  
  try {
    const session = await sessionManager.claim({
      authToken: credentials.authToken,
      modelId: MODEL,
    });
    
    console.log('✅ SUCCESS!');
    console.log('Session:', JSON.stringify(session, null, 2));
  } catch (err) {
    console.error('❌ FAILED!');
    console.error('Error name:', err.constructor.name);
    console.error('Error message:', err.message);
    
    if (err.statusCode) {
      console.error('Status code:', err.statusCode);
    }
    
    if (err.responseBody) {
      console.error('Response body:', err.responseBody);
    }
    
    if (err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }
  }
}

run();

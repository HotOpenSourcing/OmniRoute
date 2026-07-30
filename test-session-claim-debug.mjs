// Debug session claim to see HTML response
process.env.RESIDENTIAL_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTPS_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';
process.env.HTTP_PROXY = 'http://benyahiamoutie:STvFGibnqj@209.101.203.231:50100';

import { createHttpClient } from './src/lib/providers/freebuff/cliEmulator/httpClient.ts';

const credentials = {
  authToken: '747000d5-6839-48a9-b467-9c0e167a5cd8',
};

const MODEL = 'deepseek/deepseek-v4-flash';

async function testEndpoint(url, label) {
  const httpClient = await createHttpClient();
  
  console.log(`\n=== Testing: ${label} ===`);
  console.log(`URL: ${url}`);
  
  const response = await httpClient.fetch({
    url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.authToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'user-agent': 'ai-sdk/openai-compatible/1.0.0/codebuff',
      'x-freebuff-model': MODEL,
    },
    body: JSON.stringify({ modelId: MODEL }),
  });

  console.log('  status:', response.status);
  console.log('  ok:', response.ok);
  
  const bodyText = await response.text();
  console.log('  body (first 200 chars):', bodyText.slice(0, 200));
}

async function run() {
  // Test multiple possible endpoints
  await testEndpoint('https://www.codebuff.com/api/v1/session', 'v1/session');
  await testEndpoint('https://www.codebuff.com/api/v1/freebuff/session', 'v1/freebuff/session');
  await testEndpoint('https://api.codebuff.com/v1/session', 'api.codebuff.com/v1/session');
  await testEndpoint('https://api.codebuff.com/v1/freebuff/session', 'api.codebuff.com/v1/freebuff/session');
}

run().catch(err => {
  console.error('ERROR:', err.message);
});

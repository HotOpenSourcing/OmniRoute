// Direct probe with tls-client-node (bun_0.1.0) to see real upstream body
import { fetch as tlsFetch } from 'tls-client-node';

const AUTH_TOKEN = '747000d5-6839-48a9-b467-9c0e167a5cd8';

async function probe(modelId) {
  console.log(`\n=== POST /api/v1/freebuff/session modelId=${modelId} ===`);
  const url = 'https://www.codebuff.com/api/v1/freebuff/session';
  const headers = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'user-agent': 'ai-sdk/openai-compatible/1.0.0/codebuff',
    'x-freebuff-model': modelId,
  };
  const body = JSON.stringify({ modelId });

  try {
    const r = await tlsFetch(url, {
      method: 'POST',
      headers,
      body,
      clientIdentifier: 'bun_0.1.0',
    });
    console.log('status:', r.status, r.statusText);
    let text = '';
    if (typeof r.body === 'string') text = r.body;
    else if (r.body) text = Buffer.from(r.body).toString('utf-8');
    console.log('body:', text.slice(0, 4000));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

const models = [
  'deepseek/deepseek-v4-flash/limited',
  'deepseek/deepseek-v4-pro/premium',
  'minimax/minimax-m3',
  'minimax/minimax-m2.7/legacy',
  'mimo/mimo-v2.5/limited',
];

for (const m of models) {
  await probe(m);
}

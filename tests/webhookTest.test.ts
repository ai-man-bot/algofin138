import assert from 'node:assert/strict';
import { sendWebhookTest } from '../src/utils/webhookTest.ts';
const original = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.test/webhook?token=owned');
    assert.equal(init?.body, 'invalid payload');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'omit');
    return new Response('{"error":"Invalid message"}', {status:400});
  };
  assert.deepEqual(await sendWebhookTest('https://example.test/webhook?token=owned','invalid payload','text/plain'), {status:400,ok:false,body:{error:'Invalid message'}});
  globalThis.fetch = async () => { calls++; throw new Error('network'); };
  await assert.rejects(sendWebhookTest('https://example.test','payload','text/plain'), /Delivery may have occurred/);
  assert.equal(calls,2,'no automatic retry on ambiguous delivery');
} finally { globalThis.fetch = original; }
console.log('Webhook test delivery and error handling passed');

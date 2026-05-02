import assert from 'node:assert/strict';
import { brokersAPI, getRequestMetrics } from '../src/utils/api.ts';

const originalFetch = globalThis.fetch;

let fetchCount = 0;
const responses = [
  [{ id: 'alpaca:1', broker_type: 'alpaca', status: 'connected' }],
  { ok: true },
  [{ id: 'alpaca:2', broker_type: 'alpaca', status: 'connected' }],
];

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = responses[fetchCount];
  fetchCount += 1;

  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}) as typeof fetch;

const first = await brokersAPI.getAll({ forceRefresh: true });
const second = await brokersAPI.getAll();

assert.equal(fetchCount, 1);
assert.deepEqual(first, second);

await brokersAPI.connect({ broker_type: 'alpaca', name: 'Paper' });
const third = await brokersAPI.getAll();

assert.equal(fetchCount, 3);
assert.equal(Array.isArray(third), true);
assert.equal(third[0]?.id, 'alpaca:2');

const metrics = getRequestMetrics();
assert.ok(metrics.some((metric) => metric.path === '/brokers' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/brokers' && metric.method === 'POST'));

if (originalFetch) {
  globalThis.fetch = originalFetch;
}

console.log('api cache tests passed');

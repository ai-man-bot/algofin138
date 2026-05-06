import assert from 'node:assert/strict';
import { createRequestCache } from '../src/utils/requestCache.ts';

let currentTime = 0;
const cache = createRequestCache(() => currentTime);

let fetchCount = 0;
const firstValue = await cache.load(
  'portfolio',
  async () => {
    fetchCount += 1;
    return { version: 1 };
  },
  { ttlMs: 1_000 },
);

assert.deepEqual(firstValue, { version: 1 });
assert.equal(fetchCount, 1);

currentTime = 500;

const cachedValue = await cache.load(
  'portfolio',
  async () => {
    fetchCount += 1;
    return { version: 2 };
  },
  { ttlMs: 1_000 },
);

assert.deepEqual(cachedValue, { version: 1 });
assert.equal(fetchCount, 1);

currentTime = 1_500;

let resolveRefresh: ((value: { version: number }) => void) | null = null;
const staleValue = await cache.load(
  'portfolio',
  () =>
    new Promise<{ version: number }>((resolve) => {
      fetchCount += 1;
      resolveRefresh = resolve;
    }),
  { ttlMs: 1_000 },
);

assert.deepEqual(staleValue, { version: 1 });
assert.equal(fetchCount, 2);

resolveRefresh?.({ version: 2 });
await Promise.resolve();

assert.deepEqual(cache.peek('portfolio'), { version: 2 });

cache.invalidate('port');
assert.equal(cache.peek('portfolio'), undefined);

const dedupeCache = createRequestCache(() => 10);
let dedupedFetchCount = 0;
let resolveDedupedFetch: ((value: { ok: boolean }) => void) | null = null;
const pendingA = dedupeCache.load(
  'brokers',
  () =>
    new Promise<{ ok: boolean }>((resolve) => {
      dedupedFetchCount += 1;
      resolveDedupedFetch = resolve;
    }),
);
const pendingB = dedupeCache.load(
  'brokers',
  async () => {
    dedupedFetchCount += 1;
    return { ok: false };
  },
);

assert.equal(dedupedFetchCount, 1);
assert.equal(dedupeCache.getStatus('brokers').state, 'refreshing');

resolveDedupedFetch?.({ ok: true });
assert.deepEqual(await pendingA, { ok: true });
assert.deepEqual(await pendingB, { ok: true });
assert.deepEqual(dedupeCache.peek('brokers'), { ok: true });
assert.equal(dedupeCache.getStatus('brokers').state, 'ready');
assert.equal(dedupeCache.getStatus('brokers').error, null);

const statusEvents: string[] = [];
const unsubscribe = dedupeCache.subscribe('brokers', (status) => {
  statusEvents.push(status.state);
});

await dedupeCache.load(
  'brokers',
  async () => {
    dedupedFetchCount += 1;
    throw new Error('network down');
  },
  { forceRefresh: true },
).catch(() => null);

unsubscribe();

assert.deepEqual(dedupeCache.peek('brokers'), { ok: true });
assert.equal(dedupeCache.getStatus('brokers').state, 'error');
assert.equal(dedupeCache.getStatus('brokers').error?.message, 'network down');
assert.ok(statusEvents.includes('refreshing'));
assert.ok(statusEvents.includes('error'));

console.log('requestCache tests passed');

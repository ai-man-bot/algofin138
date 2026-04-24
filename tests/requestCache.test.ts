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

console.log('requestCache tests passed');

import assert from 'node:assert/strict';
import { buildAlpacaQuotesResponse, normalizeQuoteSnapshot } from '../src/utils/quoteSnapshot.ts';

// Full Alpaca v2 snapshot: latest trade, quote, and previous daily bar.
const fullSnapshot = {
  latestTrade: { t: '2026-10-09T15:00:00Z', p: 198.22 },
  latestQuote: { t: '2026-10-09T15:00:01Z', ap: 198.24, bp: 198.20 },
  dailyBar: { t: '2026-10-09T05:00:00Z', o: 195.50, c: 198.10 },
  prevDailyBar: { t: '2026-10-08T05:00:00Z', o: 194.00, c: 196.98 },
};

const normalizedFull = normalizeQuoteSnapshot('aapl', fullSnapshot);
assert.equal(normalizedFull.symbol, 'AAPL');
assert.equal(normalizedFull.price, 198.22);
assert.equal(normalizedFull.ap, 198.24);
assert.equal(normalizedFull.bp, 198.2);
assert.equal(normalizedFull.previousClose, 196.98);
assert.ok(Math.abs(normalizedFull.change - 1.24) < 1e-9);
assert.ok(Math.abs(normalizedFull.changePct - (1.24 / 196.98) * 100) < 1e-9);
assert.equal(normalizedFull.asOf, '2026-10-09T15:00:00Z');

// Snapshot with no trade/quote data falls back to the daily close.
const sparseSnapshot = { dailyBar: { o: 190.00, c: 191.00 }, prevDailyBar: { c: 190.00 } };
const normalizedSparse = normalizeQuoteSnapshot('SPY', sparseSnapshot);
assert.equal(normalizedSparse.price, 191);
assert.equal(normalizedSparse.previousClose, 190);
assert.ok(Math.abs(normalizedSparse.change - 1) < 1e-9);
assert.ok(Math.abs(normalizedSparse.changePct - (1 / 190) * 100) < 1e-9);
assert.equal(normalizedSparse.ap, null);
assert.equal(normalizedSparse.bp, null);

// Missing snapshot data yields nulls instead of fake prices.
const normalizedEmpty = normalizeQuoteSnapshot('TSLA', null);
assert.equal(normalizedEmpty.price, null);
assert.equal(normalizedEmpty.previousClose, null);
assert.equal(normalizedEmpty.change, 0);
assert.equal(normalizedEmpty.changePct, 0);
assert.equal(normalizedEmpty.asOf, null);

// Batch response maps the Alpaca snapshots object into keyed quotes.
const batch = buildAlpacaQuotesResponse({
  AAPL: fullSnapshot,
  nvda: { latestTrade: { t: '2026-10-09T15:00:00Z', p: 921.55 }, latestQuote: { ap: 921.60, bp: 921.50 }, prevDailyBar: { c: 895.40 } },
});
assert.deepEqual(Object.keys(batch.quotes).sort(), ['AAPL', 'NVDA']);
assert.equal(batch.quotes.AAPL.price, 198.22);
assert.equal(batch.quotes.NVDA.price, 921.55);
assert.ok(Math.abs(batch.quotes.NVDA.changePct - ((921.55 - 895.4) / 895.4) * 100) < 1e-9);

// Empty/absent batch payloads and non-object entries produce an empty quotes map.
assert.deepEqual(buildAlpacaQuotesResponse(undefined), { quotes: {} });
assert.deepEqual(buildAlpacaQuotesResponse({}), { quotes: {} });
assert.deepEqual(buildAlpacaQuotesResponse({ junk: 'not-an-object', other: null }), { quotes: {} });

console.log('quote snapshot tests passed');

import assert from 'node:assert/strict';
import {
  buildOptionOrderLegs,
  buildSampleOptionContracts,
  estimateOptionOrderPremium,
  filterOptionChainRows,
  findDefaultOptionContract,
  getOptionExpirations,
  normalizeOptionChainRows,
} from '../src/utils/optionChain.ts';

const rows = normalizeOptionChainRows(buildSampleOptionContracts('TQQQ'), {
  TQQQ260717C00070000: {
    latestQuote: { bp: 7.42, ap: 7.86 },
    latestTrade: { p: 7.68, s: 1136 },
    greeks: { delta: 0.61, implied_volatility: 0.44 },
    openInterest: 3957,
  },
});

assert.equal(rows[0].underlyingSymbol, 'TQQQ');
assert.deepEqual(getOptionExpirations(rows), ['2026-07-17']);

const calls = filterOptionChainRows({ rows, expirationDate: '2026-07-17', type: 'call' });
assert.equal(calls.length, 4);
assert.ok(calls.every((row) => row.type === 'call'));

const selected = findDefaultOptionContract({
  rows,
  expirationDate: '2026-07-17',
  type: 'call',
  underlyingPrice: 71.55,
});

assert.ok(selected);
assert.equal(selected?.symbol, 'TQQQ260717C00072000');

const vertical = buildOptionOrderLegs({
  strategyType: 'vertical',
  selected: calls[1],
  rows,
  quantity: 1,
  side: 'buy',
});

assert.equal(vertical.length, 2);
assert.equal(vertical[0].side, 'buy');
assert.equal(vertical[1].side, 'sell');
assert.ok(vertical[1].strikePrice > vertical[0].strikePrice);

const straddle = buildOptionOrderLegs({
  strategyType: 'straddle',
  selected: calls[1],
  rows,
  quantity: 2,
  side: 'buy',
});

assert.equal(straddle.length, 2);
assert.notEqual(straddle[0].type, straddle[1].type);
assert.equal(straddle[0].ratioQuantity, 2);
assert.equal(typeof estimateOptionOrderPremium(straddle), 'number');

console.log('option chain tests passed');

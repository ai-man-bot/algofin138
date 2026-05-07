import assert from 'node:assert/strict';
import {
  createStrategyLabStrategyDefinition,
  normalizeStrategyLabBar,
  normalizeStrategyLabQuote,
} from '../src/utils/strategyLabModels.ts';
import {
  normalizeAlpacaBars,
  normalizeAlpacaQuote,
} from '../src/utils/strategyLabMarketData.ts';
import { generateStrategyLabPineScript } from '../src/utils/pinescriptGenerator.ts';
import { runStrategyLabBacktest } from '../src/utils/backtestEngine.ts';
import {
  expandOptimizerRange,
  runStrategyLabOptimization,
} from '../src/utils/optimizerEngine.ts';

const strategy = createStrategyLabStrategyDefinition({
  name: 'RSI Momentum',
  symbol: ' aapl ',
  assetClass: 'equity',
  direction: 'long',
  indicators: {
    rsiLength: 14,
    emaShort: 20,
    emaLong: 50,
    macdFast: 12,
    macdSlow: 26,
    macdSignal: 9,
  },
  risk: {
    stopLossPct: 3,
    takeProfitPct: 8,
    trailingStopPct: 1.5,
  },
  positionSizing: {
    type: 'percent_of_equity',
    value: 5,
  },
});

assert.equal(strategy.symbol, 'AAPL');
assert.equal(strategy.indicators.rsiLength, 14);
assert.throws(
  () => createStrategyLabStrategyDefinition({ name: '', symbol: 'AAPL' }),
  /Strategy name is required/,
);
assert.throws(
  () => createStrategyLabStrategyDefinition({ name: 'Bad', symbol: 'AAPL', indicators: { rsiLength: 1 } }),
  /RSI length must be at least 2/,
);

const quote = normalizeStrategyLabQuote({
  symbol: 'msft',
  price: '411.25',
  previousClose: 400,
  currency: 'USD',
  source: 'alpaca',
});
assert.equal(quote.symbol, 'MSFT');
assert.equal(quote.change, 11.25);
assert.equal(quote.changePct, 2.8125);

const bar = normalizeStrategyLabBar({
  t: '2026-05-01T13:30:00Z',
  o: '100',
  h: '105',
  l: '99',
  c: '103',
  v: '1000000',
});
assert.equal(bar.close, 103);
assert.equal(bar.volume, 1000000);

const alpacaQuote = normalizeAlpacaQuote('aapl', {
  trade: { p: 195.5, t: '2026-05-06T20:00:00Z' },
  quote: { bp: 195.4, ap: 195.6 },
  previousDailyBar: { c: 190 },
});
assert.equal(alpacaQuote.symbol, 'AAPL');
assert.equal(alpacaQuote.price, 195.5);
assert.equal(alpacaQuote.previousClose, 190);

const bars = normalizeAlpacaBars({
  bars: [
    { t: '2026-01-01T00:00:00Z', o: 100, h: 103, l: 99, c: 101, v: 1000 },
    { t: '2026-01-02T00:00:00Z', o: 101, h: 104, l: 100, c: 102, v: 1200 },
  ],
});
assert.equal(bars.length, 2);
assert.equal(bars[1].close, 102);

const pine = generateStrategyLabPineScript({
  strategy,
  routeToken: 'route-123',
  strategyId: 'strategy-123',
});
assert.ok(pine.code.includes('//@version=5'));
assert.ok(pine.code.includes('"route_token":"route-123"'));
assert.ok(pine.code.includes('"source":"strategylab_pinescript"'));
assert.equal(pine.alertPayload.source, 'strategylab_pinescript');
assert.equal(pine.alertPayload.strategy_id, 'strategy-123');

const downBars = Array.from({ length: 35 }, (_, index) => {
  const close = index < 20 ? 100 - index : 80 + index * 0.5;
  return normalizeStrategyLabBar({
    time: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    open: close + 0.2,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index,
  });
});
const noTradeBacktest = runStrategyLabBacktest({
  strategy,
  bars: downBars.slice(0, 20),
  initialCapital: 10000,
});
assert.equal(noTradeBacktest.status, 'insufficient_data');

const tradeBacktest = runStrategyLabBacktest({
  strategy,
  bars: downBars,
  initialCapital: 10000,
});
assert.equal(tradeBacktest.status, 'complete');
assert.equal(typeof tradeBacktest.metrics.totalReturnPct, 'number');
assert.ok(Array.isArray(tradeBacktest.trades));

assert.deepEqual(expandOptimizerRange({ min: 10, max: 14, step: 2 }), [10, 12, 14]);
assert.throws(() => expandOptimizerRange({ min: 1, max: 1000, step: 0 }), /step must be greater than 0/);

const optimization = runStrategyLabOptimization({
  strategy,
  bars: downBars,
  targetMetric: 'sharpe',
  ranges: {
    rsiLength: { min: 10, max: 14, step: 2 },
    stopLossPct: { min: 2, max: 4, step: 1 },
    takeProfitPct: { min: 5, max: 7, step: 1 },
  },
  maxCombinations: 50,
});
assert.equal(optimization.status, 'complete');
assert.ok(optimization.combinationsTested <= 27);
assert.ok(optimization.results.length <= 27);

assert.throws(
  () => runStrategyLabOptimization({
    strategy,
    bars: downBars,
    targetMetric: 'sharpe',
    ranges: {
      rsiLength: { min: 2, max: 100, step: 1 },
      stopLossPct: { min: 1, max: 20, step: 1 },
      takeProfitPct: { min: 1, max: 20, step: 1 },
    },
    maxCombinations: 100,
  }),
  /exceeds maxCombinations/,
);

console.log('strategy lab tests passed');

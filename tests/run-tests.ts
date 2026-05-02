import './requestCache.test.ts';
import './apiCache.test.ts';
import './brokerModels.test.ts';
import assert from 'node:assert/strict';
import {
  calculateBacktestMetrics,
  calculateDivergenceAlerts,
  calculateLiveMetricsFromTrades,
  calculatePerformanceMetricsFromPairs,
  createTradingPairs,
} from '../src/utils/tradeAnalytics.ts';

const pairs = createTradingPairs([
  { symbol: 'AAPL', side: 'buy', status: 'filled', qty: 10, filled_avg_price: 100, filled_at: '2026-01-01T10:00:00Z' },
  { symbol: 'AAPL', side: 'sell', status: 'filled', qty: 10, filled_avg_price: 110, filled_at: '2026-01-03T10:00:00Z' },
]);
assert.equal(pairs.length, 1);
assert.equal(pairs[0].profitDollar, 100);
assert.equal(pairs[0].profitPercent, 10);

const liveMetrics = calculateLiveMetricsFromTrades([
  { status: 'filled', pnl: 500, submittedAt: '2026-01-01T10:00:00Z', closedAt: '2026-01-03T10:00:00Z' },
  { status: 'filled', pnl: -200, submittedAt: '2026-01-05T10:00:00Z', closedAt: '2026-01-07T10:00:00Z' },
], 10000);
assert.ok(liveMetrics);
assert.equal(liveMetrics?.totalPnL, 300);
assert.equal(liveMetrics?.totalTrades, 2);
assert.equal(liveMetrics?.winRate, 50);

const backtestInput = {
  initialCapital: 10000,
  netProfit: 3000,
  netProfitPercent: 30,
  maxEquityDrawdown: -800,
  maxEquityDrawdownPercent: 8,
  totalTrades: 20,
  winningTrades: 12,
  losingTrades: 8,
  percentProfitable: 60,
  avgPnL: 150,
  avgWinningTrade: 300,
  avgLosingTrade: -120,
  ratioAvgWinLoss: 2.5,
  sharpeRatio: 1.8,
  profitFactor: 2,
};
const backtest = calculateBacktestMetrics(backtestInput);
const alerts = calculateDivergenceAlerts(backtestInput, {
  ...backtest,
  totalPnLPercent: 5,
  winRate: 35,
  profitFactor: 1.1,
  maxDrawdownPercent: 18,
});
assert.equal(backtest.avgLoss, 120);
assert.ok(alerts.length >= 3);

const advancedMetrics = calculatePerformanceMetricsFromPairs([
  { symbol: 'AAPL', entryTime: '2026-01-01T10:00:00Z', exitTime: '2026-01-02T10:00:00Z', profitDollar: 100, profitPercent: 10, return: 0.1 },
  { symbol: 'MSFT', entryTime: '2026-01-03T10:00:00Z', exitTime: '2026-01-04T10:00:00Z', profitDollar: -50, profitPercent: -5, return: -0.05 },
]);
assert.notEqual(advancedMetrics.sharpeRatio, 0);
assert.equal(typeof advancedMetrics.sortinoRatio, 'number');
assert.equal(typeof advancedMetrics.dailyVaR, 'number');

console.log('tradeAnalytics tests passed');

import assert from 'node:assert/strict';
import { aggregateBrokerKpis, buildActivityRows, mapRecentOrders, summarizePositions } from '../src/utils/velvetDashboard.ts';

const kpis = aggregateBrokerKpis([
  { equity: 100_000, buyingPower: 250_000, dayChange: 500, totalPnl: 2000 },
  { equity: 50_000, buyingPower: 75_000, dayChange: -100, totalPnl: 900 },
]);

assert.equal(kpis.equity, 150_000);
assert.equal(kpis.buyingPower, 325_000);
assert.equal(kpis.dayChange, 400);
assert.equal(Number(kpis.dayChangePercent.toFixed(4)), 0.2667);

const orders = mapRecentOrders([
  { symbol: 'AAPL', side: 'buy', quantity: '2', averageFillPrice: '100', submittedAt: '2026-05-01T10:00:00Z' },
  { symbol: 'NVDA', action: 'sell', qty: 1, price: 900, submittedAt: '2026-05-01T12:00:00Z', status: 'filled' },
]);

assert.equal(orders[0].symbol, 'NVDA');
assert.equal(orders[0].side, 'SELL');
assert.equal(orders[0].total, 900);

const positions = summarizePositions([
  { asset: 'TQQQ', qty: '3', currentPrice: '72.5', pl: '-12.4', plPercent: '-1.2' },
]);

assert.equal(positions[0].symbol, 'TQQQ');
assert.equal(positions[0].quantity, 3);
assert.equal(positions[0].pnl, -12.4);

const activity = buildActivityRows({
  positions,
  orders,
  notifications: [{ type: 'risk_limit_hit', title: 'Risk trimmed order', createdAt: '2026-05-01T12:30:00Z' }],
});

assert.equal(activity.length, 4);
assert.equal(activity[0].headline, 'Risk trimmed order');

console.log('velvet dashboard tests passed');

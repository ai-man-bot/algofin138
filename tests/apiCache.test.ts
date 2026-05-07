import assert from 'node:assert/strict';
import { alpacaAPI, brokersAPI, getCachedRequestSnapshot, getRequestMetrics, notificationsAPI, strategiesAPI, strategyLabAPI, testWebhook } from '../src/utils/api.ts';

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
const brokerCacheSnapshot = getCachedRequestSnapshot('/brokers');

assert.equal(fetchCount, 1);
assert.deepEqual(first, second);
assert.equal(Array.isArray(brokerCacheSnapshot?.data), true);
assert.equal(typeof brokerCacheSnapshot?.updatedAt, 'number');

await brokersAPI.connect({ broker_type: 'alpaca', name: 'Paper' });
const third = await brokersAPI.getAll();

assert.equal(fetchCount, 3);
assert.equal(Array.isArray(third), true);
assert.equal(third[0]?.id, 'alpaca:2');

await notificationsAPI.markAsRead('note-1');
await notificationsAPI.markAllAsRead();
await notificationsAPI.saveSettings({ pushEnabled: true });
await testWebhook('https://example.com/hook', { action: 'buy' });

assert.equal(fetchCount, 7);

await strategyLabAPI.getQuote('AAPL', { forceRefresh: true });
await strategyLabAPI.getBars('AAPL', { timeframe: '1D', period: '2y', limit: 250 }, { forceRefresh: true });
await strategyLabAPI.createStrategy({ name: 'RSI Momentum', symbol: 'AAPL' });
await strategyLabAPI.updateStrategy('strategy-lab-1', { name: 'RSI Momentum v2' });
await strategyLabAPI.generatePineScript('strategy-lab-1', { routeToken: 'route-token' });
await strategyLabAPI.runBacktest({ strategyId: 'strategy-lab-1', symbol: 'AAPL' });
await strategyLabAPI.getBacktest('backtest-1', { forceRefresh: true });
await strategyLabAPI.runOptimization({ strategyId: 'strategy-lab-1', symbol: 'AAPL' });
await strategyLabAPI.getOptimization('optimizer-1', { forceRefresh: true });
await strategyLabAPI.exportToAlgoFin({ strategyId: 'strategy-lab-1', mode: 'paper' });
await alpacaAPI.getAccount('alpaca:PA3A82Y1AMF0', { forceRefresh: true }).catch(() => null);
await alpacaAPI.getPositions('alpaca:PA3A82Y1AMF0', { forceRefresh: true }).catch(() => []);
await alpacaAPI.getOrders('alpaca:PA3A82Y1AMF0', 'all', 500, { forceRefresh: true }).catch(() => []);
await alpacaAPI.getPortfolioHistory('alpaca:PA3A82Y1AMF0', '1M', '1D').catch(() => null);
await strategiesAPI.getAll({ forceRefresh: true }).catch(() => []);
await strategiesAPI.create({ name: 'Legacy Strategy', strategyType: 'tradingview' }).catch(() => null);
await strategiesAPI.update('legacy-strategy-1', { status: 'active' }).catch(() => null);
await strategiesAPI.delete('legacy-strategy-1').catch(() => null);

assert.equal(fetchCount, 25);

const metrics = getRequestMetrics();
assert.ok(metrics.some((metric) => metric.path === '/brokers' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/brokers' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/notifications/note-1/read' && metric.method === 'PUT'));
assert.ok(metrics.some((metric) => metric.path === '/notifications/mark-all-read' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/notification-settings' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/test-webhook' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/market/quote?symbol=AAPL' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path.startsWith('/strategy-lab/market/bars?') && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/strategies' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/strategies/strategy-lab-1' && metric.method === 'PUT'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/strategies/strategy-lab-1/pinescript' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/backtests' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/backtests/backtest-1' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/optimizations' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/optimizations/optimizer-1' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/strategy-lab/exports/algofin' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/alpaca/account?brokerId=alpaca%3APA3A82Y1AMF0' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/alpaca/positions?brokerId=alpaca%3APA3A82Y1AMF0' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/alpaca/orders?brokerId=alpaca%3APA3A82Y1AMF0&status=all&limit=500' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/alpaca/portfolio-history?brokerId=alpaca%3APA3A82Y1AMF0&period=1M&timeframe=1D' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/strategies' && metric.method === 'GET'));
assert.ok(metrics.some((metric) => metric.path === '/strategies' && metric.method === 'POST'));
assert.ok(metrics.some((metric) => metric.path === '/strategies/legacy-strategy-1' && metric.method === 'PUT'));
assert.ok(metrics.some((metric) => metric.path === '/strategies/legacy-strategy-1' && metric.method === 'DELETE'));

if (originalFetch) {
  globalThis.fetch = originalFetch;
}

console.log('api cache tests passed');

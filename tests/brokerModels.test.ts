import assert from 'node:assert/strict';
import {
  normalizeBrokerConnection,
  normalizeAlpacaAccount,
  normalizeAlpacaPosition,
  normalizeAlpacaOrder,
} from '../src/utils/brokerModels.ts';
import { evaluateRisk } from '../src/utils/riskEngine.ts';

const broker = normalizeBrokerConnection({
  id: 'alpaca:paper-123',
  brokerType: 'alpaca',
  name: 'Paper Alpaca',
  accountId: 'paper-123',
  connected: true,
  connectedAt: '2026-04-24T10:00:00Z',
});

assert.equal(broker.id, 'alpaca:paper-123');
assert.equal(broker.provider, 'alpaca');
assert.equal(broker.capabilities.supportsEquities, true);
assert.equal(broker.capabilities.supportsOptions, false);
assert.equal(broker.status, 'connected');

const account = normalizeAlpacaAccount({
  equity: '105000.50',
  last_equity: '103500.25',
  buying_power: '250000',
  cash: '10000',
});

assert.equal(account.equity, 105000.5);
assert.equal(account.buyingPower, 250000);
assert.equal(account.dayChange, 1500.25);
assert.equal(account.dayChangePercent.toFixed(2), '1.45');

const position = normalizeAlpacaPosition({
  symbol: 'NVDA',
  qty: '10',
  side: 'long',
  avg_entry_price: '800',
  current_price: '840',
  market_value: '8400',
  cost_basis: '8000',
  unrealized_pl: '400',
  unrealized_plpc: '0.05',
});

assert.equal(position.symbol, 'NVDA');
assert.equal(position.quantity, 10);
assert.equal(position.marketValue, 8400);
assert.equal(position.unrealizedPnLPercent, 5);

const order = normalizeAlpacaOrder({
  id: 'ord-1',
  symbol: 'NVDA',
  side: 'buy',
  type: 'market',
  status: 'filled',
  qty: '10',
  filled_qty: '10',
  filled_avg_price: '805.5',
  submitted_at: '2026-04-24T10:00:00Z',
  filled_at: '2026-04-24T10:00:02Z',
});

assert.equal(order.id, 'ord-1');
assert.equal(order.quantity, 10);
assert.equal(order.averageFillPrice, 805.5);
assert.equal(order.status, 'filled');

const riskDecision = evaluateRisk({
  userId: 'user-1',
  order: {
    symbol: 'TSLA',
    side: 'buy',
    quantity: 10,
    orderType: 'market',
    limitPrice: 0,
    requestedAt: '2026-04-24T10:15:00Z',
  },
  account: {
    equity: 100000,
    buyingPower: 150000,
    dayChange: -500,
    dayChangePercent: -0.5,
    notionalExposure: 60000,
  },
  positions: [
    {
      symbol: 'AAPL',
      quantity: 20,
      marketValue: 10000,
      unrealizedPnL: -250,
    },
  ],
  openOrders: [
    {
      id: 'open-1',
      symbol: 'TSLA',
      side: 'buy',
      status: 'new',
      quantity: 5,
      averageFillPrice: 0,
    },
  ],
  strategy: {
    id: 'strategy-1',
    name: 'Momentum',
    maxPositionSize: 5000,
    maxNotionalExposure: 65000,
    maxDailyLoss: 400,
    restrictedSymbols: ['GME'],
    allowedSymbols: ['AAPL', 'TSLA', 'NVDA'],
  },
  riskSettings: {
    killSwitchEnabled: false,
  },
});

assert.equal(riskDecision.status, 'warn');
assert.ok(riskDecision.issues.some((issue) => issue.code === 'duplicate_order'));
assert.ok(riskDecision.issues.some((issue) => issue.code === 'max_daily_loss'));
assert.ok(riskDecision.issues.some((issue) => issue.code === 'max_position_size'));
assert.ok(riskDecision.summary.includes('duplicate_order'));

const blockedDecision = evaluateRisk({
  userId: 'user-1',
  order: {
    symbol: 'GME',
    side: 'buy',
    quantity: 1,
    orderType: 'market',
    requestedAt: '2026-04-24T10:20:00Z',
  },
  account: {
    equity: 100000,
    buyingPower: 150000,
    dayChange: 0,
    dayChangePercent: 0,
    notionalExposure: 0,
  },
  positions: [],
  openOrders: [],
  strategy: {
    id: 'strategy-2',
    name: 'Restricted',
    restrictedSymbols: ['GME'],
  },
  riskSettings: {
    killSwitchEnabled: true,
  },
});

assert.equal(blockedDecision.status, 'block');
assert.ok(blockedDecision.issues.some((issue) => issue.code === 'kill_switch'));
assert.ok(blockedDecision.issues.some((issue) => issue.code === 'restricted_symbol'));

console.log('broker model and risk engine tests passed');

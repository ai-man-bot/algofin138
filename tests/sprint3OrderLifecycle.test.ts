import assert from 'node:assert/strict';
import {
  buildAdvancedOrderSupportMatrix,
  createOrderLifecycle,
  createOrderLifecycleFromSignal,
  createOptionLeg,
  reconcileOrderLifecycle,
} from '../src/utils/orderLifecycle.ts';
import { normalizeBrokerConnection } from '../src/utils/brokerModels.ts';

const ibkrConnection = normalizeBrokerConnection({
  id: 'ibkr:paper-1',
  brokerType: 'interactive_brokers',
  name: 'IBKR Paper',
  connected: true,
});

const alpacaConnection = normalizeBrokerConnection({
  id: 'alpaca:paper-1',
  brokerType: 'alpaca',
  name: 'Alpaca Paper',
  connected: true,
});

const callLeg = createOptionLeg({
  underlyingSymbol: 'AAPL',
  expirationDate: '2026-06-19',
  strikePrice: 200,
  optionType: 'call',
  side: 'buy',
  quantity: 1,
  limitPrice: 5.25,
});

assert.equal(callLeg.symbol, 'AAPL260619C00200000');
assert.equal(callLeg.assetClass, 'option');
assert.equal(callLeg.contractMultiplier, 100);

const spreadOrder = createOrderLifecycle({
  broker: ibkrConnection,
  source: 'manual',
  strategyId: 'strategy-options-1',
  generatedAt: '2026-05-06T12:00:00Z',
  legs: [
    callLeg,
    createOptionLeg({
      underlyingSymbol: 'AAPL',
      expirationDate: '2026-06-19',
      strikePrice: 210,
      optionType: 'call',
      side: 'sell',
      quantity: 1,
      limitPrice: 2.1,
    }),
  ],
  instructions: {
    orderClass: 'oco',
    timeInForce: 'gtd',
    goodTillDate: '2026-05-10',
    takeProfit: { limitPrice: 6.5 },
    stopLoss: { stopPrice: 3.5 },
  },
});

assert.equal(spreadOrder.assetClass, 'option');
assert.equal(spreadOrder.instrumentType, 'multi_leg_option');
assert.equal(spreadOrder.status, 'pending_risk');
assert.equal(spreadOrder.lifecycleEvents[0].type, 'created');
assert.equal(spreadOrder.instructions.timeInForce, 'gtd');
assert.deepEqual(spreadOrder.capabilityWarnings, []);

const alpacaSupport = buildAdvancedOrderSupportMatrix(alpacaConnection, spreadOrder);
assert.equal(alpacaSupport.supportsOptions, false);
assert.equal(alpacaSupport.supportsMultiLegOptions, false);

const reconciled = reconcileOrderLifecycle(spreadOrder, [
  {
    id: 'exec-1',
    brokerOrderId: 'broker-leg-1',
    legId: spreadOrder.legs[0].id,
    status: 'partially_filled',
    filledQuantity: 1,
    averageFillPrice: 5,
    occurredAt: '2026-05-06T12:01:00Z',
  },
  {
    id: 'exec-2',
    brokerOrderId: 'broker-leg-2',
    legId: spreadOrder.legs[1].id,
    status: 'new',
    filledQuantity: 0,
    averageFillPrice: 0,
    occurredAt: '2026-05-06T12:01:01Z',
  },
]);

assert.equal(reconciled.status, 'partially_filled');
assert.equal(reconciled.filledQuantity, 1);
assert.equal(reconciled.averageFillPrice, 5);
assert.equal(reconciled.lifecycleEvents.some((event) => event.type === 'partial_fill'), true);

const blockedSignal = createOrderLifecycleFromSignal({
  signal: {
    strategyId: 'strategy-options-1',
    symbol: 'AAPL260619C00200000',
    assetClass: 'option',
    side: 'buy',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'day',
    limitPrice: 5,
    signalSource: 'python-strategy-runner',
    generatedAt: '2026-05-06T12:02:00Z',
    option: {
      underlyingSymbol: 'AAPL',
      expirationDate: '2026-06-19',
      strikePrice: 200,
      optionType: 'call',
    },
  },
  broker: alpacaConnection,
  userId: 'user-1',
  account: {
    equity: 100000,
    buyingPower: 100000,
    dayChange: 0,
    dayChangePercent: 0,
    notionalExposure: 0,
  },
  positions: [],
  openOrders: [],
});

assert.equal(blockedSignal.riskDecision.status, 'block');
assert.equal(blockedSignal.order.status, 'rejected');
assert.equal(blockedSignal.auditRecord.source, 'python-strategy-runner');
assert.equal(blockedSignal.auditRecord.issueCodes.includes('unsupported_asset_class'), true);

const allowedSignal = createOrderLifecycleFromSignal({
  signal: {
    strategyId: 'strategy-equity-1',
    symbol: 'MSFT',
    assetClass: 'equity',
    side: 'buy',
    quantity: 10,
    orderType: 'market',
    timeInForce: 'day',
    marketPrice: 410,
    signalSource: 'python-strategy-runner',
    generatedAt: '2026-05-06T12:03:00Z',
  },
  broker: alpacaConnection,
  userId: 'user-1',
  account: {
    equity: 100000,
    buyingPower: 100000,
    dayChange: 0,
    dayChangePercent: 0,
    notionalExposure: 20000,
  },
  positions: [],
  openOrders: [],
});

assert.equal(allowedSignal.riskDecision.status, 'allow');
assert.equal(allowedSignal.order.status, 'accepted');
assert.equal(allowedSignal.order.source, 'python-strategy-runner');
assert.equal(allowedSignal.order.estimatedNotional, 4100);

console.log('Sprint 3 order lifecycle tests passed');

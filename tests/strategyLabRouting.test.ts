import assert from 'node:assert/strict';
import {
  buildOmsOrderInsertRow,
  buildRiskAuditInsertRow,
  buildStrategyLabExportRow,
  buildStrategyLabSignalFromPayload,
  buildWebhookEventStatusUpdate,
} from '../src/utils/orderRoutingPersistence.ts';
import { createOrderLifecycleFromSignal } from '../src/utils/orderLifecycle.ts';
import { normalizeBrokerConnection } from '../src/utils/brokerModels.ts';

const signal = buildStrategyLabSignalFromPayload(
  {
    action: 'buy',
    symbol: ' msft ',
    quantity: '10',
    price: '410.5',
    source: 'strategylab_pinescript',
    route_token: 'route-123',
    strategy_id: 'strategy-123',
  },
  {
    fallbackSource: 'webhook',
    strategyId: 'strategy-123',
  },
);

assert.equal(signal.symbol, 'MSFT');
assert.equal(signal.side, 'buy');
assert.equal(signal.quantity, 10);
assert.equal(signal.marketPrice, 410.5);
assert.equal(signal.signalSource, 'strategylab_pinescript');
assert.equal(signal.metadata?.routeToken, 'route-123');

assert.throws(
  () =>
    buildStrategyLabSignalFromPayload(
      { action: 'buy', symbol: '', quantity: 1 },
      { fallbackSource: 'webhook' },
    ),
  /symbol is required/i,
);

const broker = normalizeBrokerConnection({
  id: 'alpaca:paper-1',
  brokerType: 'alpaca',
  name: 'Alpaca Paper',
  connected: true,
});

const routed = createOrderLifecycleFromSignal({
  signal,
  broker,
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
  riskSettings: {
    authorizedUserIds: ['user-1'],
  },
});

const omsInsert = buildOmsOrderInsertRow('user-1', routed.order);
assert.equal(omsInsert.user_id, 'user-1');
assert.equal(omsInsert.source, 'strategylab_pinescript');
assert.equal(omsInsert.status, 'accepted');
assert.equal(omsInsert.raw_signal.symbol, 'MSFT');

const auditInsert = buildRiskAuditInsertRow(routed.auditRecord);
assert.equal(auditInsert.user_id, 'user-1');
assert.equal(auditInsert.source, 'strategylab_pinescript');
assert.equal(auditInsert.order_payload.symbol, 'MSFT');

const exportRow = buildStrategyLabExportRow({
  userId: 'user-1',
  strategyId: 'strategy-123',
  routeId: 'route-row-1',
  routeToken: 'route-123',
  mode: 'paper',
  alertPayload: { route_token: 'route-123', symbol: 'MSFT' },
  generatedPineScript: '//@version=5',
});

assert.equal(exportRow.user_id, 'user-1');
assert.equal(exportRow.strategy_id, 'strategy-123');
assert.equal(exportRow.route_id, 'route-row-1');
assert.equal(exportRow.route_token, 'route-123');
assert.equal(exportRow.source, 'strategylab_pinescript');
assert.equal(exportRow.webhook_path.includes('token=route-123'), true);

const eventUpdate = buildWebhookEventStatusUpdate({
  status: 'blocked',
  orderId: 'oms-1',
  auditRecordId: 'audit-1',
  riskDecision: routed.riskDecision,
});

assert.equal(eventUpdate.status, 'blocked');
assert.equal(eventUpdate.order_id, 'oms-1');
assert.equal(eventUpdate.risk_audit_record_id, 'audit-1');
assert.equal(eventUpdate.decision_summary, routed.riskDecision.summary);

console.log('strategy lab routing tests passed');

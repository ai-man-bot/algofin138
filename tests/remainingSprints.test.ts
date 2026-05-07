import assert from 'node:assert/strict';
import { normalizeBrokerConnection } from '../src/utils/brokerModels.ts';
import {
  createPlatformOrderIntent,
  routeOrderIntentThroughRiskGate,
} from '../src/utils/riskGate.ts';
import {
  buildAutomationRunPlan,
  createStrategyAutomationSchedule,
  selectExecutableSignals,
} from '../src/utils/strategyAutomation.ts';
import {
  evaluateProductionReadiness,
  summarizeReadiness,
} from '../src/utils/productionReadiness.ts';

const alpaca = normalizeBrokerConnection({
  id: 'alpaca:paper-1',
  brokerType: 'alpaca',
  connected: true,
  name: 'Alpaca Paper',
});

const ibkr = normalizeBrokerConnection({
  id: 'ibkr:paper-1',
  brokerType: 'interactive_brokers',
  connected: true,
  name: 'IBKR Paper',
});

const account = {
  equity: 100000,
  buyingPower: 50000,
  dayChange: 0,
  dayChangePercent: 0,
  notionalExposure: 20000,
};

const webhookIntent = createPlatformOrderIntent({
  source: 'webhook',
  strategyId: 'strategy-1',
  symbol: 'AAPL',
  assetClass: 'equity',
  side: 'buy',
  quantity: 5,
  orderType: 'limit',
  timeInForce: 'day',
  limitPrice: 190,
  generatedAt: '2026-05-06T14:00:00Z',
});

const routedWebhook = routeOrderIntentThroughRiskGate({
  intent: webhookIntent,
  broker: alpaca,
  userId: 'user-1',
  account,
  positions: [],
  openOrders: [],
});

assert.equal(routedWebhook.decision.status, 'allow');
assert.equal(routedWebhook.order.status, 'accepted');
assert.equal(routedWebhook.order.source, 'webhook');
assert.equal(routedWebhook.auditRecord.source, 'webhook');

const blockedOptionsWebhook = routeOrderIntentThroughRiskGate({
  intent: createPlatformOrderIntent({
    source: 'webhook',
    strategyId: 'strategy-2',
    symbol: 'AAPL260619C00200000',
    assetClass: 'option',
    side: 'buy',
    quantity: 1,
    orderType: 'limit',
    timeInForce: 'day',
    limitPrice: 5,
    generatedAt: '2026-05-06T14:01:00Z',
    option: {
      underlyingSymbol: 'AAPL',
      expirationDate: '2026-06-19',
      strikePrice: 200,
      optionType: 'call',
    },
  }),
  broker: alpaca,
  userId: 'user-1',
  account,
  positions: [],
  openOrders: [],
});

assert.equal(blockedOptionsWebhook.decision.status, 'block');
assert.equal(blockedOptionsWebhook.order.status, 'rejected');
assert.equal(blockedOptionsWebhook.auditRecord.issueCodes.includes('unsupported_asset_class'), true);

const schedule = createStrategyAutomationSchedule({
  strategyId: 'strategy-1',
  enabled: true,
  intervalMinutes: 15,
  maxSignalsPerRun: 2,
  minConfidence: 0.7,
  allowedSymbols: ['AAPL', 'MSFT'],
});

const executableSignals = selectExecutableSignals({
  schedule,
  now: '2026-05-06T15:00:00Z',
  previousRunAt: '2026-05-06T14:40:00Z',
  signals: [
    { id: 'sig-1', symbol: 'AAPL', confidence: 0.9, generatedAt: '2026-05-06T14:59:00Z' },
    { id: 'sig-2', symbol: 'MSFT', confidence: 0.75, generatedAt: '2026-05-06T14:58:00Z' },
    { id: 'sig-3', symbol: 'TSLA', confidence: 0.95, generatedAt: '2026-05-06T14:57:00Z' },
    { id: 'sig-4', symbol: 'AAPL', confidence: 0.65, generatedAt: '2026-05-06T14:56:00Z' },
  ],
});

assert.deepEqual(executableSignals.map((signal) => signal.id), ['sig-1', 'sig-2']);

const runPlan = buildAutomationRunPlan({
  schedule,
  broker: ibkr,
  userId: 'user-1',
  account,
  positions: [],
  openOrders: [],
  signals: executableSignals.map((signal) => ({
    strategyId: schedule.strategyId,
    symbol: signal.symbol,
    assetClass: 'equity',
    side: 'buy',
    quantity: 1,
    orderType: 'market',
    timeInForce: 'day',
    marketPrice: signal.symbol === 'AAPL' ? 190 : 410,
    signalSource: 'python-strategy-runner',
    generatedAt: signal.generatedAt,
    metadata: { confidence: signal.confidence },
  })),
});

assert.equal(runPlan.status, 'ready');
assert.equal(runPlan.acceptedOrders.length, 2);
assert.equal(runPlan.blockedOrders.length, 0);
assert.equal(runPlan.auditRecords.length, 2);

const readiness = evaluateProductionReadiness({
  requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALPACA_API_KEY'],
  presentEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
  requiredMigrations: [
    'risk_settings',
    'risk_audit_records',
    'oms_orders',
    'strategy_automation_runs',
  ],
  appliedMigrations: [
    'risk_settings',
    'risk_audit_records',
    'oms_orders',
    'strategy_automation_runs',
  ],
  requiredRoutes: [
    '/trade-assistant/confirm',
    '/platform-orders/route',
    '/strategy-automation/run',
  ],
  availableRoutes: [
    '/trade-assistant/confirm',
    '/platform-orders/route',
    '/strategy-automation/run',
  ],
  checks: [
    { name: 'npm test', status: 'pass' },
    { name: 'npm run build', status: 'pass' },
  ],
});

assert.equal(readiness.status, 'blocked');
assert.ok(readiness.blockers.some((blocker) => blocker.includes('ALPACA_API_KEY')));
assert.ok(summarizeReadiness(readiness).includes('blocked'));

console.log('remaining Sprint 4 and Sprint 5 tests passed');

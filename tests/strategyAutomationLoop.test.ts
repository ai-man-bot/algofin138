import assert from 'node:assert/strict';
import { handleStrategyAutomationRoutes } from '../supabase/functions/webhook-listener/strategy_automation_routes.ts';

/**
 * Strategy automation execution loop tests: schedule persistence, run gating
 * (enabled, interval, confidence, symbols, max per run), risk-gated routing,
 * OMS + audit persistence, and opt-in broker submission with journal-first
 * idempotency. All database access is mocked; no broker is contacted.
 */

const userId = '11111111-1111-4111-8111-111111111111';
const strategyId = '22222222-2222-4222-8222-222222222222';

const tables: Record<string, any[]> = {
  strategy_automation_schedules: [],
  strategy_automation_runs: [],
  risk_audit_records: [],
  oms_orders: [],
  oms_executions: [],
};

let insertCounter = 0;
const dbFrom = (table: string) => {
  const filters: Array<{ key: string; value: any; negate?: boolean }> = [];
  let values: any, mode = '', single = false, count = 1000;
  let orderKey: string | null = null, orderAscending = true;
  const match = (row: any) => filters.every((f) => (f.negate ? row[f.key] !== f.value : row[f.key] === f.value));
  const run = () => {
    let result = (tables[table] || []).filter(match);
    if (orderKey) {
      result = result.slice().sort((a, b) => {
        const av = Date.parse(a[orderKey!]) || 0;
        const bv = Date.parse(b[orderKey!]) || 0;
        return orderAscending ? av - bv : bv - av;
      });
    }
    const stampDefaults = (row: any) => {
      if (!row.started_at) row.started_at = new Date().toISOString();
      if (!row.created_at) row.created_at = row.started_at;
    };
    if (mode === 'insert') {
      if (!values.id) values.id = `gen-${table}-${++insertCounter}`;
      stampDefaults(values);
      tables[table].push(values);
      result = [values];
    }
    if (mode === 'upsert') {
      const existing = tables[table].find((row) => row.user_id === values.user_id && row.strategy_id === values.strategy_id);
      if (existing) {
        Object.assign(existing, values);
        result = [existing];
      } else {
        if (!values.id) values.id = `gen-${table}-${++insertCounter}`;
        stampDefaults(values);
        tables[table].push(values);
        result = [values];
      }
    }
    return { data: single ? result[0] || null : result.slice(0, count), error: null };
  };
  const q: any = {
    select() { return q; },
    eq(key: string, value: any) { filters.push({ key, value }); return q; },
    neq(key: string, value: any) { filters.push({ key, value, negate: true }); return q; },
    order(key: string, options?: { ascending?: boolean }) { orderKey = key; orderAscending = options?.ascending !== false; return q; },
    limit(n: number) { count = n; return q; },
    maybeSingle() { single = true; return q; },
    single() { single = true; return q; },
    insert(row: any) { mode = 'insert'; values = row; return q; },
    upsert(row: any) { mode = 'upsert'; values = row; return q; },
    then(resolve: any, reject: any) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  return q;
};

const brokerSnapshot = {
  connection: {
    id: 'alpaca:paper',
    provider: 'alpaca',
    brokerType: 'paper',
    name: 'Paper',
    accountId: 'PA-1',
    status: 'connected',
    connected: true,
    connectedAt: null,
    capabilities: {
      supportsEquities: true,
      supportsOptions: true,
      supportsCrypto: true,
      supportsFractionalShares: true,
      supportsBracketOrders: true,
      supportsTrailingStops: true,
      supportsStreamingData: true,
    },
    raw: {},
  },
  account: { equity: 100000, buyingPower: 50000, dayChange: 0, dayChangePercent: 0, notionalExposure: 0 },
  positions: [],
  openOrders: [],
};

const submittedOrders: Record<string, any>[] = [];
let submitCallCount = 0;

const deps: any = {
  supabase: { from: dbFrom },
  userId,
  resolveBrokerAccountId: async (explicit: string | null) =>
    explicit ? { brokerAccountId: explicit, error: null } : { brokerAccountId: 'alpaca:paper', error: null },
  loadBrokerSnapshot: async () => ({ snapshot: brokerSnapshot, error: null }),
  loadRiskSettings: async () => ({}),
  getBrokerForSubmission: async () => ({
    broker: { id: 'alpaca:paper', base_url: 'https://paper-api.alpaca.markets' },
    headers: { 'APCA-API-KEY-ID': 'test' },
    error: null,
  }),
  submitOrder: async (_broker: any, _headers: any, order: Record<string, any>) => {
    submitCallCount += 1;
    submittedOrders.push(order);
    return { ok: true, status: 200, response: { id: `broker-order-${submitCallCount}` } };
  },
  lookupOrder: async () => null,
};

const baseUrl = 'https://project.supabase.co/functions/v1/webhook-listener';
const request = (path: string, method = 'GET', body?: any) => {
  const url = new URL(`${baseUrl}${path}`);
  return handleStrategyAutomationRoutes(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url, deps);
};

/* ---------- schedule CRUD ---------- */

let response = await request('/strategy-automation/schedules', 'GET');
assert.equal(response?.status, 200);
assert.deepEqual(response?.body, []);

response = await request(`/strategy-automation/schedules/${strategyId}`, 'PUT', { intervalMinutes: 0 });
assert.equal(response?.status, 400, 'invalid interval rejected');

response = await request(`/strategy-automation/schedules/${strategyId}`, 'PUT', { intervalMinutes: 15, minConfidence: 1.5 });
assert.equal(response?.status, 400, 'invalid confidence rejected');

response = await request(`/strategy-automation/schedules/${strategyId}`, 'PUT', {
  enabled: true,
  intervalMinutes: 15,
  maxSignalsPerRun: 2,
  minConfidence: 0.7,
  allowedSymbols: ['AAPL'],
});
assert.equal(response?.status, 200);
assert.equal(response?.body.schedule.strategy_id, strategyId);
assert.equal(response?.body.schedule.enabled, true);

const list = await request('/strategy-automation/schedules', 'GET');
assert.equal(list?.body.length, 1);

/* ---------- run gating ---------- */

// No signals: run recorded as no_signals.
response = await request('/strategy-automation/run', 'POST', { strategy_id: strategyId });
assert.equal(response?.status, 200);
assert.equal(response?.body.run.status, 'no_signals');
assert.equal(tables.oms_orders.length, 0, 'no signals must not create orders');

// Signal below the confidence floor is filtered out.
response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  signals: [{ id: 'sig-1', symbol: 'AAPL', side: 'buy', quantity: 10, metadata: { confidence: 0.3 } }],
});
assert.equal(response?.body.run.status, 'no_signals', 'below-threshold confidence is filtered');

// Disallowed symbol is filtered out.
response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  signals: [{ id: 'sig-2', symbol: 'MSFT', side: 'buy', quantity: 5, metadata: { confidence: 0.9 } }],
});
assert.equal(response?.body.run.status, 'no_signals', 'symbol outside the allowlist is filtered');

/* ---------- routing without auto-execute ---------- */

// Simulate elapsed time so the interval gate does not skip the scenarios below.
const backdateCompletedRuns = () => {
  tables.strategy_automation_runs
    .filter((row) => row.status === 'completed')
    .forEach((row) => {
      row.started_at = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    });
};
backdateCompletedRuns();

response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  signals: [{ id: 'sig-3', symbol: 'AAPL', side: 'buy', quantity: 10, orderType: 'market', metadata: { confidence: 0.9 } }],
});
assert.equal(response?.body.run.status, 'completed');
assert.equal(response?.body.plan.accepted_order_ids.length, 1, 'risk allowed the signal');
assert.equal(response?.body.plan.blocked_order_ids.length, 0);
assert.equal(response?.body.plan.audit_record_ids.length, 1, 'an audit record is persisted per routed signal');
assert.equal(tables.risk_audit_records.length, 1);
assert.equal(tables.oms_orders.length, 1);
assert.equal(tables.oms_orders[0].user_id, userId);
assert.equal(tables.oms_orders[0].asset_class, 'equity');
assert.equal(response?.body.plan.submissions['sig-3'].status, 'oms_recorded');
assert.equal(response?.body.plan.submissions['sig-3'].submitted, false);
assert.equal(submitCallCount, 0, 'no broker submission without auto_execute');
assert.deepEqual(tables.oms_executions, [], 'no execution rows without auto_execute');

/* ---------- routing with auto-execute ---------- */

backdateCompletedRuns();

const omsBefore = tables.oms_orders.length;
response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  auto_execute: true,
  signals: [
    { id: 'sig-4', symbol: 'AAPL', side: 'buy', quantity: 3, orderType: 'limit', limitPrice: 150.25, metadata: { confidence: 0.95 } },
    { id: 'sig-5', symbol: 'AAPL', side: 'buy', quantity: 2, orderType: 'market', metadata: { confidence: 0.8 } },
    { id: 'sig-6', symbol: 'AAPL', side: 'buy', quantity: 1, orderType: 'market', metadata: { confidence: 0.2 } },
    { id: 'sig-7', symbol: 'TSLA', side: 'buy', quantity: 1, orderType: 'market', metadata: { confidence: 0.99 } },
  ],
});
assert.equal(response?.body.run.status, 'completed');
// max_signals_per_run is 2: sig-4 and sig-5 selected (confidence order), sig-6 filtered by
// confidence, sig-7 filtered by allowlist.
assert.equal(response?.body.plan.accepted_order_ids.length, 2, 'max signals per run caps selection');
assert.equal(Object.keys(response?.body.plan.submissions).length, 2);
assert.equal(tables.oms_orders.length, omsBefore + 2);
assert.equal(submitCallCount, 2, 'each accepted signal is submitted once');

const statuses = tables.oms_executions.map((row) => row.status);
assert.equal(statuses.filter((status) => status === 'submission_attempted').length, 2, 'attempt journaled before each POST');
assert.equal(statuses.filter((status) => status === 'submitted').length, 2, 'submission result journaled');
const attemptRows = tables.oms_executions.filter((row) => row.status === 'submission_attempted');
assert.ok(attemptRows.every((row) => row.raw_update?.clientOrderId?.startsWith('oms-')), 'client order ids are permanent oms-prefixed ids');
assert.ok(attemptRows.every((row) => tables.oms_orders.some((order) => order.id === row.oms_order_id)), 'journal rows reference persisted OMS orders');
assert.ok(submittedOrders.every((order) => typeof order.client_order_id === 'string' && order.client_order_id.startsWith('oms-')));
assert.equal(response?.body.plan.submissions['sig-4'].status, 'submitted');
assert.equal(response?.body.plan.submissions['sig-4'].brokerOrderId, 'broker-order-1');
assert.equal(response?.body.plan.submissions['sig-5'].status, 'submitted');

/* ---------- interval gating ---------- */

// The previous run happened just now; the 15-minute interval must skip the next run.
response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  signals: [{ id: 'sig-8', symbol: 'AAPL', side: 'buy', quantity: 1, metadata: { confidence: 0.9 } }],
});
assert.equal(response?.body.run.status, 'not_due', 'runs inside the interval are skipped');
assert.equal(tables.oms_orders.length, omsBefore + 2, 'not_due runs create no orders');

/* ---------- disabled schedule ---------- */

await request(`/strategy-automation/schedules/${strategyId}`, 'PUT', {
  enabled: false,
  intervalMinutes: 15,
  maxSignalsPerRun: 2,
  minConfidence: 0.7,
  allowedSymbols: ['AAPL'],
});
response = await request('/strategy-automation/run', 'POST', {
  strategy_id: strategyId,
  signals: [{ id: 'sig-9', symbol: 'AAPL', side: 'buy', quantity: 1, metadata: { confidence: 0.9 } }],
});
assert.equal(response?.body.run.status, 'disabled');
assert.equal(tables.oms_orders.length, omsBefore + 2, 'disabled schedules never route orders');

/* ---------- missing schedule ---------- */

response = await request('/strategy-automation/run', 'POST', { strategy_id: '33333333-3333-4333-8333-333333333333' });
assert.equal(response?.status, 404);

/* ---------- run history ---------- */

response = await request(`/strategy-automation/runs?strategy_id=${strategyId}`, 'GET');
assert.equal(response?.status, 200);
assert.ok(response?.body.length >= 5, 'run history is readable');
assert.ok(response?.body.every((row: any) => row.status === 'completed' || row.status === 'no_signals' || row.status === 'not_due' || row.status === 'disabled'));

console.log('strategy automation execution loop tests passed');

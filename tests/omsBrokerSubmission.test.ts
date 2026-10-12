import assert from 'node:assert/strict';
import {
  buildAlpacaOrderFromLifecycle,
  buildOmsClientOrderId,
  isBrokerSubmittableOrder,
  submitLifecycleOrderToBroker,
} from '../src/utils/omsBrokerSubmission.ts';
import { createEquityLeg, createOrderLifecycle } from '../src/utils/orderLifecycle.ts';
import type { PlatformOrderLifecycle, BrokerSubmissionAttempt, BrokerSubmissionOutcomeRecord } from '../src/utils/omsBrokerSubmission.ts';

const broker = {
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
} as any;

function equityOrder(instructions: any = { orderType: 'market', timeInForce: 'day' }): PlatformOrderLifecycle {
  return createOrderLifecycle({
    broker,
    source: 'webhook',
    strategyId: 'strategy-1',
    legs: [createEquityLeg({ symbol: 'aapl', side: 'buy', quantity: 10, marketPrice: 150.25 })],
    instructions,
  });
}

/* ---------- eligibility ---------- */

assert.equal(isBrokerSubmittableOrder(equityOrder()).eligible, true, 'single-leg market equity order is submittable');
assert.equal(isBrokerSubmittableOrder(equityOrder({ orderType: 'limit', timeInForce: 'gtc' })).eligible, true);

const twoLegs = equityOrder();
twoLegs.legs = [
  createEquityLeg({ symbol: 'AAPL', side: 'buy', quantity: 10 }),
  createEquityLeg({ symbol: 'AAPL', side: 'sell', quantity: 10 }),
];
assert.equal(isBrokerSubmittableOrder(twoLegs).eligible, false, 'multi-leg orders are not auto-submitted in this phase');

const optionOrder = equityOrder();
optionOrder.assetClass = 'option';
optionOrder.instrumentType = 'single_leg_option';
(optionOrder.legs[0] as any).assetClass = 'option';
assert.equal(isBrokerSubmittableOrder(optionOrder).eligible, false, 'option instruments are not auto-submitted in this phase');

// Alpaca's capability model flags ioc as broker-unsupported, so warnings block submission.
const warnedOrder = equityOrder({ orderType: 'market', timeInForce: 'ioc' });
assert.ok(warnedOrder.capabilityWarnings.includes('broker_does_not_support_ioc'));
assert.equal(isBrokerSubmittableOrder(warnedOrder).eligible, false, 'capability warnings keep the order OMS-recorded only');

const zeroQty = equityOrder();
zeroQty.legs[0].quantity = 0;
assert.equal(isBrokerSubmittableOrder(zeroQty).eligible, false, 'zero quantity is not submittable');

const missingLimit = equityOrder({ orderType: 'limit', timeInForce: 'day' });
missingLimit.legs[0].limitPrice = undefined;
assert.equal(isBrokerSubmittableOrder(missingLimit).eligible, false, 'limit orders require a limit price');

/* ---------- Alpaca payload shape ---------- */

const marketOrder = equityOrder();
const marketPayload = buildAlpacaOrderFromLifecycle(marketOrder);
assert.deepEqual(
  { symbol: marketPayload.symbol, qty: marketPayload.qty, side: marketPayload.side, type: marketPayload.type, time_in_force: marketPayload.time_in_force },
  { symbol: 'AAPL', qty: 10, side: 'buy', type: 'market', time_in_force: 'day' },
);
assert.equal(marketPayload.client_order_id, buildOmsClientOrderId(marketOrder.id));
assert.equal(marketPayload.limit_price, undefined);

const limitOrder = equityOrder({ orderType: 'limit', timeInForce: 'gtc' });
const limitPayload = buildAlpacaOrderFromLifecycle(limitOrder);
assert.equal(limitPayload.type, 'limit');
assert.equal(limitPayload.limit_price, 150.25);
assert.equal(limitPayload.time_in_force, 'gtc');
assert.equal(limitPayload.stop_price, undefined);

const stopLimit = equityOrder({ orderType: 'stop_limit', timeInForce: 'day' });
stopLimit.legs[0].stopPrice = 145;
const stopLimitPayload = buildAlpacaOrderFromLifecycle(stopLimit);
assert.equal(stopLimitPayload.stop_price, 145);
assert.equal(stopLimitPayload.limit_price, 150.25);

/* ---------- submission flow with injected deps ---------- */

interface Recorded {
  calls: string[];
  attempts: BrokerSubmissionAttempt[];
  results: BrokerSubmissionOutcomeRecord[];
  submitted: Record<string, any>[];
  lookups: string[];
}

function makeDeps(recorded: Recorded, behavior: {
  submit: (order: Record<string, any>) => Promise<{ ok: boolean; status: number; response: any }>;
  lookup?: (clientOrderId: string) => Promise<Record<string, any> | null>;
}) {
  return {
    journalAttempt: async (attempt: BrokerSubmissionAttempt) => {
      recorded.calls.push('attempt');
      recorded.attempts.push(attempt);
    },
    submitOrder: async (order: Record<string, any>) => {
      recorded.calls.push('submit');
      recorded.submitted.push(order);
      return behavior.submit(order);
    },
    lookupOrderByClientId: async (clientOrderId: string) => {
      recorded.calls.push('lookup');
      recorded.lookups.push(clientOrderId);
      return behavior.lookup ? behavior.lookup(clientOrderId) : null;
    },
    journalResult: async (record: BrokerSubmissionOutcomeRecord) => {
      recorded.calls.push('result');
      recorded.results.push(record);
    },
  };
}

// 1. Accepted submission: journal-first, single POST, submitted outcome journaled.
{
  const recorded: Recorded = { calls: [], attempts: [], results: [], submitted: [], lookups: [] };
  const outcome = await submitLifecycleOrderToBroker({
    order: equityOrder(),
    deps: makeDeps(recorded, { submit: async () => ({ ok: true, status: 200, response: { id: 'broker-order-1' } }) }),
  });
  assert.equal(outcome.eligible, true);
  if (outcome.eligible) {
    assert.equal(outcome.status, 'submitted');
    assert.equal(outcome.brokerOrderId, 'broker-order-1');
  }
  assert.deepEqual(recorded.calls, ['attempt', 'submit', 'result'], 'attempt must be journaled before the POST');
  assert.equal(recorded.attempts[0].clientOrderId, buildOmsClientOrderId(recorded.attempts[0].omsOrderId));
  assert.equal(recorded.submitted.length, 1, 'exactly one POST');
  assert.equal(recorded.results[0].status, 'submitted');
  assert.equal(recorded.results[0].brokerOrderId, 'broker-order-1');
}

// 2. Definitive broker rejection: no lookup, no retry, rejected outcome journaled.
{
  const recorded: Recorded = { calls: [], attempts: [], results: [], submitted: [], lookups: [] };
  const outcome = await submitLifecycleOrderToBroker({
    order: equityOrder(),
    deps: makeDeps(recorded, { submit: async () => ({ ok: false, status: 422, response: { message: 'notional too low' } }) }),
  });
  assert.equal(outcome.eligible, true);
  if (outcome.eligible) assert.equal(outcome.status, 'broker_rejected');
  assert.deepEqual(recorded.calls, ['attempt', 'submit', 'result']);
  assert.equal(recorded.results[0].status, 'broker_rejected');
  assert.equal(recorded.submitted.length, 1, 'a rejection must not be retried');
}

// 3. Network failure without a response: resolve by lookup, never re-POST.
{
  const recorded: Recorded = { calls: [], attempts: [], results: [], submitted: [], lookups: [] };
  const order = equityOrder();
  const outcome = await submitLifecycleOrderToBroker({
    order,
    deps: makeDeps(recorded, { submit: async () => { throw new Error('network dropped'); } }),
  });
  assert.equal(outcome.eligible, true);
  if (outcome.eligible) assert.equal(outcome.status, 'submission_uncertain');
  assert.deepEqual(recorded.calls, ['attempt', 'submit', 'lookup', 'result']);
  assert.equal(recorded.lookups[0], buildOmsClientOrderId(order.id));
  assert.equal(recorded.submitted.length, 1, 'uncertainty must not trigger a second POST');
  assert.equal(recorded.results[0].status, 'submission_uncertain');
}

// 4. Uncertain 5xx where the lookup finds the order: already_submitted, no re-POST.
{
  const recorded: Recorded = { calls: [], attempts: [], results: [], submitted: [], lookups: [] };
  const outcome = await submitLifecycleOrderToBroker({
    order: equityOrder(),
    deps: makeDeps(recorded, {
      submit: async () => ({ ok: false, status: 502, response: null }),
      lookup: async () => ({ id: 'broker-order-9', status: 'accepted' }),
    }),
  });
  assert.equal(outcome.eligible, true);
  if (outcome.eligible) {
    assert.equal(outcome.status, 'already_submitted');
    assert.equal(outcome.brokerOrderId, 'broker-order-9');
  }
  assert.equal(recorded.submitted.length, 1);
  assert.equal(recorded.results[0].status, 'already_submitted');
}

// 5. Ineligible orders never touch the broker or journal an attempt.
{
  const recorded: Recorded = { calls: [], attempts: [], results: [], submitted: [], lookups: [] };
  const outcome = await submitLifecycleOrderToBroker({
    order: twoLegs,
    deps: makeDeps(recorded, { submit: async () => ({ ok: true, status: 200, response: { id: 'never' } }) }),
  });
  assert.equal(outcome.eligible, false);
  assert.deepEqual(recorded.calls, [], 'ineligible orders are never journaled or submitted');
}

console.log('OMS broker submission tests passed');

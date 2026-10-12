import type { PlatformOrderLifecycle } from './orderLifecycle.ts';

/**
 * Broker submission for risk-accepted OMS orders.
 *
 * Follows the same discipline as the option plan worker:
 *  - journal the submission attempt (including the permanent client order id)
 *    BEFORE the POST leaves the process;
 *  - on an uncertain response, look the order up by client order id and never
 *    blind re-POST;
 *  - record every outcome as an oms_executions row.
 *
 * Phase 2 scope: single-leg equity orders with market/limit/stop/stop_limit
 * instructions only. Multi-leg and option instruments stay OMS-recorded without
 * broker submission until their dedicated paths land.
 */

export const OMS_CLIENT_ORDER_PREFIX = 'oms';

export interface BrokerSubmissionAttempt {
  omsOrderId: string;
  legId: string | null;
  clientOrderId: string;
  order: Record<string, any>;
  attemptedAt: string;
}

export interface BrokerSubmissionOutcomeRecord {
  omsOrderId: string;
  legId: string | null;
  clientOrderId: string;
  brokerOrderId: string | null;
  status: 'submitted' | 'broker_rejected' | 'submission_uncertain' | 'already_submitted';
  httpStatus: number | null;
  response: unknown;
  occurredAt: string;
}

export type BrokerSubmissionOutcome = {
  status: BrokerSubmissionOutcomeRecord['status'];
  eligible: true;
  clientOrderId: string;
  brokerOrderId: string | null;
  httpStatus: number | null;
  response: unknown;
};

export type BrokerSubmissionResult =
  | { eligible: false; reason: string }
  | BrokerSubmissionOutcome;

export interface BrokerSubmissionDeps {
  /** Persist the attempt before the POST is issued. */
  journalAttempt: (attempt: BrokerSubmissionAttempt) => Promise<void>;
  /** POST the order to the broker. May throw on network failure. */
  submitOrder: (order: Record<string, any>) => Promise<{ ok: boolean; status: number; response: any }>;
  /** Look up a previously submitted order by its permanent client order id. */
  lookupOrderByClientId: (clientOrderId: string) => Promise<Record<string, any> | null>;
  /** Persist the terminal or uncertain outcome after resolution. */
  journalResult: (record: BrokerSubmissionOutcomeRecord) => Promise<void>;
}

const ELIGIBLE_ORDER_TYPES = new Set(['market', 'limit', 'stop', 'stop_limit']);
const ELIGIBLE_TIME_IN_FORCE = new Set(['day', 'gtc', 'ioc', 'fok']);

/**
 * Only single-leg equity orders with instructions Alpaca fully supports are
 * eligible for automatic broker submission. Any capability warning keeps the
 * order OMS-recorded but unexecuted.
 */
export function isBrokerSubmittableOrder(order: PlatformOrderLifecycle): { eligible: boolean; reason?: string } {
  if (order.assetClass !== 'equity' || order.instrumentType !== 'equity') {
    return { eligible: false, reason: 'Only single-leg equity orders are auto-executed in this phase' };
  }
  if (!order.legs || order.legs.length !== 1) {
    return { eligible: false, reason: 'Expected exactly one order leg' };
  }
  if (order.capabilityWarnings?.length) {
    return { eligible: false, reason: `Broker capability warnings: ${order.capabilityWarnings.join(', ')}` };
  }
  const leg = order.legs[0];
  if (!leg?.symbol || !(leg.quantity > 0)) {
    return { eligible: false, reason: 'Order leg must have a symbol and positive quantity' };
  }
  const orderType = order.instructions?.orderType;
  if (!orderType || !ELIGIBLE_ORDER_TYPES.has(orderType)) {
    return { eligible: false, reason: `Unsupported order type for broker submission: ${String(orderType)}` };
  }
  const timeInForce = order.instructions?.timeInForce;
  if (!timeInForce || !ELIGIBLE_TIME_IN_FORCE.has(timeInForce)) {
    return { eligible: false, reason: `Unsupported time in force for broker submission: ${String(timeInForce)}` };
  }
  if ((orderType === 'limit' || orderType === 'stop_limit') && !(typeof leg.limitPrice === 'number' && leg.limitPrice > 0)) {
    return { eligible: false, reason: 'Limit orders require a positive limit price' };
  }
  if ((orderType === 'stop' || orderType === 'stop_limit') && !(typeof leg.stopPrice === 'number' && leg.stopPrice > 0)) {
    return { eligible: false, reason: 'Stop orders require a positive stop price' };
  }
  return { eligible: true };
}

/** Permanent, deterministic client order id for an OMS order. */
export function buildOmsClientOrderId(omsOrderId: string) {
  return `${OMS_CLIENT_ORDER_PREFIX}-${omsOrderId}`;
}

/** Convert a lifecycle order into an Alpaca v2 order payload. */
export function buildAlpacaOrderFromLifecycle(order: PlatformOrderLifecycle) {
  const eligibility = isBrokerSubmittableOrder(order);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason);
  }
  const leg = order.legs[0];
  const orderType = order.instructions.orderType;
  const payload: Record<string, any> = {
    symbol: leg.symbol,
    qty: leg.quantity,
    side: leg.side,
    type: orderType,
    time_in_force: order.instructions.timeInForce,
    client_order_id: buildOmsClientOrderId(order.id),
  };
  if (orderType === 'limit' || orderType === 'stop_limit') {
    payload.limit_price = leg.limitPrice;
  }
  if (orderType === 'stop' || orderType === 'stop_limit') {
    payload.stop_price = leg.stopPrice;
  }
  return payload;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Submit a risk-accepted lifecycle order to the broker with journal-first
 * idempotency. Never re-POSTs after an uncertain outcome.
 */
export async function submitLifecycleOrderToBroker(input: {
  order: PlatformOrderLifecycle;
  deps: BrokerSubmissionDeps;
}): Promise<BrokerSubmissionResult> {
  const eligibility = isBrokerSubmittableOrder(input.order);
  if (!eligibility.eligible) {
    return { eligible: false, reason: eligibility.reason ?? 'Order not eligible for broker submission' };
  }

  const payload = buildAlpacaOrderFromLifecycle(input.order);
  const clientOrderId = String(payload.client_order_id);
  const legId = input.order.legs[0]?.id ?? null;

  await input.deps.journalAttempt({
    omsOrderId: input.order.id,
    legId,
    clientOrderId,
    order: payload,
    attemptedAt: nowIso(),
  });

  try {
    const result = await input.deps.submitOrder(payload);

    if (result.ok) {
      const record: BrokerSubmissionOutcomeRecord = {
        omsOrderId: input.order.id,
        legId,
        clientOrderId,
        brokerOrderId: result.response?.id ?? null,
        status: 'submitted',
        httpStatus: result.status,
        response: result.response,
        occurredAt: nowIso(),
      };
      await input.deps.journalResult(record);
      return {
        eligible: true,
        status: 'submitted',
        clientOrderId,
        brokerOrderId: record.brokerOrderId,
        httpStatus: result.status,
        response: result.response,
      };
    }

    // Definitive broker rejection (4xx with a parsed response) never retries.
    if (result.status >= 400 && result.status < 500 && result.response) {
      const record: BrokerSubmissionOutcomeRecord = {
        omsOrderId: input.order.id,
        legId,
        clientOrderId,
        brokerOrderId: result.response?.id ?? null,
        status: 'broker_rejected',
        httpStatus: result.status,
        response: result.response,
        occurredAt: nowIso(),
      };
      await input.deps.journalResult(record);
      return {
        eligible: true,
        status: 'broker_rejected',
        clientOrderId,
        brokerOrderId: record.brokerOrderId,
        httpStatus: result.status,
        response: result.response,
      };
    }

    // 5xx or unparsed responses are uncertain: resolve via lookup, never re-POST.
    return await resolveUncertainSubmission(input, clientOrderId, legId, result.status, result.response);
  } catch (error: any) {
    // Network failure or thrown error before/without a definitive response.
    return await resolveUncertainSubmission(input, clientOrderId, legId, null, { error: error?.message ?? 'submission failed' });
  }
}

async function resolveUncertainSubmission(
  input: { order: PlatformOrderLifecycle; deps: BrokerSubmissionDeps },
  clientOrderId: string,
  legId: string | null,
  httpStatus: number | null,
  response: unknown,
): Promise<BrokerSubmissionOutcome> {
  const existing = await input.deps.lookupOrderByClientId(clientOrderId).catch(() => null);

  if (existing?.id) {
    const record: BrokerSubmissionOutcomeRecord = {
      omsOrderId: input.order.id,
      legId,
      clientOrderId,
      brokerOrderId: String(existing.id),
      status: 'already_submitted',
      httpStatus,
      response: existing,
      occurredAt: nowIso(),
    };
    await input.deps.journalResult(record);
    return {
      eligible: true,
      status: 'already_submitted',
      clientOrderId,
      brokerOrderId: record.brokerOrderId,
      httpStatus,
      response: existing,
    };
  }

  const record: BrokerSubmissionOutcomeRecord = {
    omsOrderId: input.order.id,
    legId,
    clientOrderId,
    brokerOrderId: null,
    status: 'submission_uncertain',
    httpStatus,
    response,
    occurredAt: nowIso(),
  };
  await input.deps.journalResult(record);
  return {
    eligible: true,
    status: 'submission_uncertain',
    clientOrderId,
    brokerOrderId: null,
    httpStatus,
    response,
  };
}

import { selectExecutableSignals, type CandidateSignal } from '../../../src/utils/strategyAutomation.ts';
import type { StrategySignal } from '../../../src/utils/orderLifecycle.ts';
import { createOrderLifecycleFromSignal } from '../../../src/utils/orderLifecycle.ts';
import type { RiskSettings } from '../../../src/utils/riskEngine.ts';
import { buildRiskAuditInsertRow, buildOmsOrderInsertRow } from '../../../src/utils/orderRoutingPersistence.ts';
import { submitLifecycleOrderToBroker } from '../../../src/utils/omsBrokerSubmission.ts';

/**
 * Strategy automation execution loop.
 *
 * GET  /strategy-automation/schedules            list schedules
 * PUT  /strategy-automation/schedules/:strategy  upsert schedule
 * POST /strategy-automation/run                 execute a run now
 *
 * The run endpoint implements the ADR-001 ingestion contract: the platform
 * (today: the caller; later: the Python strategy runner) submits normalized
 * signal intents, the schedule rules gate them (enabled, interval, minimum
 * confidence, allowed symbols, max per run), accepted signals are routed
 * through the shared risk gate, and OMS orders plus audit records are
 * persisted. Broker submission happens only when the request explicitly sets
 * auto_execute: true — schedule-driven trading is opt-in per run.
 */

const MAX_SIGNALS_PER_REQUEST = 20;

export interface StrategyAutomationRouteDeps {
  supabase: any;
  userId: string;
  /** Resolve the broker account for the run (explicit id or primary account). */
  resolveBrokerAccountId: (explicitBrokerId?: string | null) => Promise<{ brokerAccountId: string | null; error: string | null }>;
  /** Load the live normalized broker snapshot (connection, account, positions, open orders). */
  loadBrokerSnapshot: (brokerAccountId: string | null) => Promise<{ snapshot: any; error: string | null }>;
  /** Load the user's risk settings. */
  loadRiskSettings: () => Promise<RiskSettings>;
  /** Broker credentials for submission. */
  getBrokerForSubmission: (brokerAccountId: string) => Promise<{ broker: any; headers: Record<string, string> | null; error: string | null }>;
  submitOrder: (broker: any, headers: Record<string, string>, order: Record<string, any>) => Promise<{ ok: boolean; status: number; response: any }>;
  lookupOrder: (broker: any, headers: Record<string, string>, clientOrderId: string) => Promise<Record<string, any> | null>;
}

interface AutomationScheduleRow {
  id: string;
  user_id: string;
  strategy_id: string;
  enabled: boolean;
  interval_minutes: number;
  max_signals_per_run: number;
  min_confidence: number;
  allowed_symbols: string[];
  created_at: string;
  updated_at: string;
}

function nowIso() {
  return new Date().toISOString();
}

const fail = (error: any) => { if (error) throw new Error(error.message); };

async function insertExecutionRow(
  supabase: any,
  input: {
    omsOrderId: string;
    legId?: string | null;
    brokerOrderId?: string | null;
    status: string;
    rawUpdate: Record<string, any>;
    occurredAt?: string;
  },
) {
  const { error } = await supabase.from('oms_executions').insert({
    oms_order_id: input.omsOrderId,
    broker_order_id: input.brokerOrderId ?? null,
    leg_id: input.legId ?? null,
    status: input.status,
    filled_quantity: 0,
    average_fill_price: 0,
    raw_update: input.rawUpdate,
    occurred_at: input.occurredAt ?? nowIso(),
  });
  if (error) throw new Error(`Failed to journal execution row: ${error.message}`);
}

export async function handleStrategyAutomationRoutes(
  req: Request,
  url: URL,
  deps: StrategyAutomationRouteDeps,
): Promise<{ body: any; status: number } | null> {
  const { supabase, userId } = deps;
  const path = url.pathname;
  const respond = (body: any, status = 200) => ({ body, status });
  const method = req.method;

  if (path.endsWith('/strategy-automation/schedules') && method === 'GET') {
    const { data, error } = await supabase
      .from('strategy_automation_schedules')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    fail(error);
    return respond(data ?? []);
  }

  const scheduleMatch = path.match(/\/strategy-automation\/schedules\/([^/]+)$/);
  if (scheduleMatch && method === 'PUT') {
    const strategyId = scheduleMatch[1];
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return respond({ error: 'Expected an object' }, 400);
    }
    const intervalMinutes = Number(body.intervalMinutes ?? body.interval_minutes ?? 15);
    const maxSignalsPerRun = Number(body.maxSignalsPerRun ?? body.max_signals_per_run ?? 1);
    const minConfidence = Number(body.minConfidence ?? body.min_confidence ?? 0.7);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1 || !Number.isFinite(maxSignalsPerRun) || maxSignalsPerRun < 1) {
      return respond({ error: 'intervalMinutes and maxSignalsPerRun must be positive numbers' }, 400);
    }
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
      return respond({ error: 'minConfidence must be between 0 and 1' }, 400);
    }
    const row = {
      user_id: userId,
      strategy_id: strategyId,
      enabled: Boolean(body.enabled),
      interval_minutes: Math.floor(intervalMinutes),
      max_signals_per_run: Math.floor(maxSignalsPerRun),
      min_confidence: minConfidence,
      allowed_symbols: Array.isArray(body.allowedSymbols)
        ? body.allowedSymbols
        : Array.isArray(body.allowed_symbols)
          ? body.allowed_symbols
          : [],
      updated_at: nowIso(),
    };
    const { data, error } = await supabase
      .from('strategy_automation_schedules')
      .upsert(row, { onConflict: 'user_id,strategy_id' })
      .select('*')
      .single();
    fail(error);
    return respond({ ok: true, schedule: data });
  }

  if (path.endsWith('/strategy-automation/run') && method === 'POST') {
    // runStrategyAutomation already returns the { body, status } response shape.
    return await runStrategyAutomation(deps, await readBody(req));
  }

  if (path.endsWith('/strategy-automation/runs') && method === 'GET') {
    const strategyId = url.searchParams.get('strategy_id') ?? url.searchParams.get('strategyId');
    let query = supabase
      .from('strategy_automation_runs')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20);
    if (strategyId) {
      query = query.eq('strategy_id', strategyId);
    }
    const { data, error } = await query;
    fail(error);
    return respond(data ?? []);
  }

  return null;
}

async function readBody(req: Request): Promise<any> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Expected an object');
    }
    return body;
  } catch (error: any) {
    throw new Error(error?.message || 'Expected a JSON object body');
  }
}

async function runStrategyAutomation(
  deps: StrategyAutomationRouteDeps,
  body: Record<string, any>,
): Promise<{ body: any; status: number }> {
  const { supabase, userId } = deps;
  const strategyId = body.strategy_id ?? body.strategyId;
  if (!strategyId || typeof strategyId !== 'string') {
    return { body: { error: 'Missing strategy_id' }, status: 400 };
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('strategy_automation_schedules')
    .select('*')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .maybeSingle();
  fail(scheduleError);

  if (!schedule) {
    return { body: { error: 'No automation schedule exists for this strategy. Save one first.' }, status: 404 };
  }
  if (!schedule.enabled) {
    const { data: run, error: runError } = await supabase
      .from('strategy_automation_runs')
      .insert({ user_id: userId, strategy_id: strategyId, status: 'disabled', metadata: { reason: 'schedule disabled' } })
      .select('*')
      .single();
    fail(runError);
    return { body: { ok: true, run, status: 'disabled' }, status: 200 };
  }

  // Interval gate: only runs that actually routed signals count toward the
  // interval. Bookkeeping runs (no_signals / not_due / disabled / failed) must
  // not delay the next real execution.
  const { data: previousRun, error: previousRunError } = await supabase
    .from('strategy_automation_runs')
    .select('started_at, status')
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(previousRunError);

  const signals = Array.isArray(body.signals) ? body.signals.slice(0, MAX_SIGNALS_PER_REQUEST) : [];
  const now = nowIso();
  const indexedSignals = signals.map((raw: any, index: number) => ({
    raw,
    id: String(raw?.id ?? `signal-${index}`),
  }));
  const candidates: CandidateSignal[] = indexedSignals.map((entry) => ({
    id: entry.id,
    symbol: String(entry.raw?.symbol ?? '').trim().toUpperCase(),
    confidence: Number(entry.raw?.metadata?.confidence ?? entry.raw?.confidence ?? 0),
    generatedAt: String(entry.raw?.generatedAt ?? entry.raw?.generated_at ?? now),
  }));
  const selected = selectExecutableSignals({
    schedule: toAutomationSchedule(schedule),
    now,
    previousRunAt: previousRun?.started_at ?? null,
    signals: candidates,
  });

  if (selected.length === 0) {
    const reason = previousRun?.started_at && candidates.length > 0 ? 'not_due' : 'no_signals';
    const { data: run, error: runError } = await supabase
      .from('strategy_automation_runs')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        status: reason,
        metadata: {
          reason,
          signals_received: candidates.length,
          previous_run_at: previousRun?.started_at ?? null,
          interval_minutes: schedule.interval_minutes,
        },
      })
      .select('*')
      .single();
    fail(runError);
    return { body: { ok: true, run, status: reason }, status: 200 };
  }

  // Resolve the broker for this run. Explicit broker_id wins; otherwise the primary account.
  const explicitBrokerId = typeof body.broker_id === 'string' && body.broker_id ? body.broker_id : null;
  const { brokerAccountId, error: brokerError } = await deps.resolveBrokerAccountId(explicitBrokerId);
  if (brokerError || !brokerAccountId) {
    const { data: run, error: runError } = await supabase
      .from('strategy_automation_runs')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        status: 'failed',
        metadata: { reason: 'no_broker', error: brokerError ?? 'No connected Alpaca broker account found' },
      })
      .select('*')
      .single();
    fail(runError);
    return { body: { ok: true, run, status: 'failed', error: brokerError ?? 'No connected Alpaca broker account found' }, status: 200 };
  }

  const [{ snapshot, error: snapshotError }, riskSettings] = await Promise.all([
    deps.loadBrokerSnapshot(brokerAccountId),
    deps.loadRiskSettings(),
  ]);
  if (snapshotError || !snapshot) {
    const { data: run, error: runError } = await supabase
      .from('strategy_automation_runs')
      .insert({
        user_id: userId,
        strategy_id: strategyId,
        status: 'failed',
        metadata: { reason: 'broker_snapshot_failed', error: snapshotError ?? 'Failed to load broker snapshot' },
      })
      .select('*')
      .single();
    fail(runError);
    return { body: { ok: true, run, status: 'failed', error: snapshotError ?? 'Failed to load broker snapshot' }, status: 200 };
  }

  const autoExecute = body.auto_execute === true;
  const selectedIds = new Set(selected.map((candidate) => candidate.id));
  const acceptedOrderIds: string[] = [];
  const blockedOrderIds: string[] = [];
  const auditRecordIds: string[] = [];
  const submissionOutcomes: Record<string, any> = {};

  for (const candidate of selected) {
    const entry = indexedSignals.find((item) => item.id === candidate.id);
    const signal = toStrategySignal(entry?.raw, {
      strategyId,
      generatedAt: candidate.generatedAt,
      confidence: candidate.confidence,
    });
    if (!signal) {
      submissionOutcomes[candidate.id] = { status: 'skipped', reason: 'invalid signal payload' };
      continue;
    }

    let routed: ReturnType<typeof createOrderLifecycleFromSignal>;
    try {
      routed = createOrderLifecycleFromSignal({
        signal,
        broker: snapshot.connection,
        userId,
        account: snapshot.account,
        positions: snapshot.positions,
        openOrders: snapshot.openOrders,
        riskSettings,
      });
    } catch (error: any) {
      submissionOutcomes[candidate.id] = { status: 'routing_failed', error: error?.message ?? 'Failed to build order lifecycle' };
      continue;
    }

    const { data: auditRow, error: auditError } = await supabase
      .from('risk_audit_records')
      .insert(buildRiskAuditInsertRow(routed.auditRecord))
      .select('*')
      .single();
    fail(auditError);
    auditRecordIds.push(auditRow.id);

    const { data: orderRow, error: orderError } = await supabase
      .from('oms_orders')
      .insert(buildOmsOrderInsertRow(userId, routed.order))
      .select('*')
      .single();
    fail(orderError);

    const riskBlocked = routed.riskDecision.status === 'block';
    if (riskBlocked) {
      blockedOrderIds.push(orderRow.id);
      submissionOutcomes[candidate.id] = { status: 'blocked_by_risk', orderId: orderRow.id, riskDecision: routed.riskDecision };
      continue;
    }
    acceptedOrderIds.push(orderRow.id);

    if (!autoExecute) {
      submissionOutcomes[candidate.id] = { status: 'oms_recorded', orderId: orderRow.id, submitted: false };
      continue;
    }

    // Align the lifecycle order id with the persisted OMS row so journal rows
    // and the permanent client order id reference the durable record.
    routed.order.id = orderRow.id;
    const { broker, headers, error: credentialsError } = await deps.getBrokerForSubmission(brokerAccountId);
    if (credentialsError || !headers || !broker) {
      submissionOutcomes[candidate.id] = { status: 'submission_failed', orderId: orderRow.id, error: credentialsError ?? 'Broker credentials unavailable' };
      continue;
    }

    try {
      const outcome = await submitLifecycleOrderToBroker({
        order: routed.order,
        deps: {
          journalAttempt: async (attempt) => {
            await insertExecutionRow(supabase, {
              omsOrderId: attempt.omsOrderId,
              legId: attempt.legId,
              status: 'submission_attempted',
              rawUpdate: { clientOrderId: attempt.clientOrderId, order: attempt.order, attemptedAt: attempt.attemptedAt },
              occurredAt: attempt.attemptedAt,
            });
          },
          submitOrder: (order) => deps.submitOrder(broker, headers, order),
          lookupOrderByClientId: (clientOrderId) => deps.lookupOrder(broker, headers, clientOrderId),
          journalResult: async (record) => {
            await insertExecutionRow(supabase, {
              omsOrderId: record.omsOrderId,
              legId: record.legId,
              brokerOrderId: record.brokerOrderId,
              status: record.status,
              rawUpdate: {
                clientOrderId: record.clientOrderId,
                httpStatus: record.httpStatus,
                response: record.response,
              },
              occurredAt: record.occurredAt,
            });
          },
        },
      });
      submissionOutcomes[candidate.id] = outcome.eligible
        ? { status: outcome.status, orderId: orderRow.id, clientOrderId: outcome.clientOrderId, brokerOrderId: outcome.brokerOrderId, submitted: outcome.status === 'submitted' || outcome.status === 'already_submitted' }
        : { status: 'not_eligible', orderId: orderRow.id, reason: outcome.reason };
    } catch (error: any) {
      submissionOutcomes[candidate.id] = { status: 'submission_failed', orderId: orderRow.id, error: error?.message ?? 'Submission failed' };
    }
  }

  const { data: run, error: runError } = await supabase
    .from('strategy_automation_runs')
    .insert({
      user_id: userId,
      strategy_id: strategyId,
      status: 'completed',
      accepted_order_ids: acceptedOrderIds,
      blocked_order_ids: blockedOrderIds,
      audit_record_ids: auditRecordIds,
      completed_at: nowIso(),
      metadata: {
        broker_account_id: brokerAccountId,
        auto_execute: autoExecute,
        signals_selected: selected.length,
        signals_received: candidates.length,
        submissions: submissionOutcomes,
        selected_ids: Array.from(selectedIds),
      },
    })
    .select('*')
    .single();
  fail(runError);

  return {
    body: {
      ok: true,
      run,
      plan: {
        status: acceptedOrderIds.length > 0 ? 'ready' : blockedOrderIds.length > 0 ? 'blocked' : 'not_due',
        accepted_order_ids: acceptedOrderIds,
        blocked_order_ids: blockedOrderIds,
        audit_record_ids: auditRecordIds,
        submissions: submissionOutcomes,
      },
    },
    status: 200,
  };
}

function toAutomationSchedule(row: AutomationScheduleRow) {
  return {
    strategyId: row.strategy_id,
    enabled: Boolean(row.enabled),
    intervalMinutes: Number(row.interval_minutes),
    maxSignalsPerRun: Number(row.max_signals_per_run),
    minConfidence: Number(row.min_confidence),
    allowedSymbols: (row.allowed_symbols ?? []).map((symbol: string) => String(symbol || '').trim().toUpperCase()).filter(Boolean),
  };
}

function toStrategySignal(raw: any, defaults: { strategyId: string; generatedAt: string; confidence: number }): StrategySignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const symbol = String(raw.symbol ?? '').trim().toUpperCase();
  const side = String(raw.side ?? '').trim().toLowerCase();
  const quantity = Number(raw.quantity ?? raw.qty);
  if (!symbol || (side !== 'buy' && side !== 'sell') || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }
  const orderType = String(raw.orderType ?? raw.order_type ?? 'market').toLowerCase();
  if (!['market', 'limit', 'stop', 'stop_limit'].includes(orderType)) return null;
  const timeInForce = String(raw.timeInForce ?? raw.time_in_force ?? 'day').toLowerCase();
  if (!['day', 'gtc', 'gtd', 'ioc', 'fok'].includes(timeInForce)) return null;

  return {
    strategyId: defaults.strategyId,
    symbol,
    assetClass: String(raw.assetClass ?? raw.asset_class ?? 'equity').toLowerCase() as StrategySignal['assetClass'],
    side: side as 'buy' | 'sell',
    quantity,
    orderType: orderType as StrategySignal['orderType'],
    timeInForce: timeInForce as StrategySignal['timeInForce'],
    limitPrice: raw.limitPrice != null || raw.limit_price != null ? Number(raw.limitPrice ?? raw.limit_price) : undefined,
    stopPrice: raw.stopPrice != null || raw.stop_price != null ? Number(raw.stopPrice ?? raw.stop_price) : undefined,
    marketPrice: raw.marketPrice != null || raw.market_price != null ? Number(raw.marketPrice ?? raw.market_price) : undefined,
    signalSource: 'python-strategy-runner',
    generatedAt: defaults.generatedAt,
    metadata: { ...(raw.metadata ?? {}), confidence: defaults.confidence },
  };
}

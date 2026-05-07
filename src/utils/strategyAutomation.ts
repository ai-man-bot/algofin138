import type {
  NormalizedBrokerAccount,
  NormalizedBrokerConnection,
  NormalizedBrokerOrder,
  NormalizedBrokerPosition,
} from './brokerModels.ts';
import type { PlatformOrderLifecycle, StrategySignal } from './orderLifecycle.ts';
import type { RiskAuditRecord, RiskSettings, RiskStrategyConfig } from './riskEngine.ts';
import {
  createPlatformOrderIntent,
  routeOrderIntentThroughRiskGate,
} from './riskGate.ts';

export interface StrategyAutomationSchedule {
  strategyId: string;
  enabled: boolean;
  intervalMinutes: number;
  maxSignalsPerRun: number;
  minConfidence: number;
  allowedSymbols: string[];
}

export interface CandidateSignal {
  id: string;
  symbol: string;
  confidence: number;
  generatedAt: string;
}

export interface AutomationRunPlanInput {
  schedule: StrategyAutomationSchedule;
  broker: NormalizedBrokerConnection;
  userId: string;
  account: Pick<NormalizedBrokerAccount, 'equity' | 'buyingPower' | 'dayChange' | 'dayChangePercent' | 'notionalExposure'>;
  positions: Array<Pick<NormalizedBrokerPosition, 'symbol' | 'quantity' | 'marketValue' | 'unrealizedPnL'>>;
  openOrders: Array<Pick<NormalizedBrokerOrder, 'id' | 'symbol' | 'side' | 'status' | 'quantity' | 'averageFillPrice'>>;
  signals: StrategySignal[];
  strategy?: RiskStrategyConfig;
  riskSettings?: RiskSettings;
}

export interface AutomationRunPlan {
  status: 'disabled' | 'not_due' | 'ready' | 'blocked';
  acceptedOrders: PlatformOrderLifecycle[];
  blockedOrders: PlatformOrderLifecycle[];
  auditRecords: RiskAuditRecord[];
}

function normalizeSymbol(value: string) {
  return String(value || '').trim().toUpperCase();
}

export function createStrategyAutomationSchedule(input: StrategyAutomationSchedule): StrategyAutomationSchedule {
  return {
    strategyId: input.strategyId,
    enabled: Boolean(input.enabled),
    intervalMinutes: Math.max(1, Math.floor(input.intervalMinutes || 1)),
    maxSignalsPerRun: Math.max(1, Math.floor(input.maxSignalsPerRun || 1)),
    minConfidence: Math.min(1, Math.max(0, input.minConfidence || 0)),
    allowedSymbols: (input.allowedSymbols || []).map(normalizeSymbol).filter(Boolean),
  };
}

function isDue(schedule: StrategyAutomationSchedule, now: string, previousRunAt?: string | null) {
  if (!previousRunAt) return true;

  const elapsedMs = Date.parse(now) - Date.parse(previousRunAt);
  return elapsedMs >= schedule.intervalMinutes * 60_000;
}

export function selectExecutableSignals(input: {
  schedule: StrategyAutomationSchedule;
  now: string;
  previousRunAt?: string | null;
  signals: CandidateSignal[];
}): CandidateSignal[] {
  const schedule = createStrategyAutomationSchedule(input.schedule);
  if (!schedule.enabled || !isDue(schedule, input.now, input.previousRunAt)) {
    return [];
  }

  const allowed = new Set(schedule.allowedSymbols);

  return input.signals
    .filter((signal) => signal.confidence >= schedule.minConfidence)
    .filter((signal) => allowed.size === 0 || allowed.has(normalizeSymbol(signal.symbol)))
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .slice(0, schedule.maxSignalsPerRun);
}

export function buildAutomationRunPlan(input: AutomationRunPlanInput): AutomationRunPlan {
  const schedule = createStrategyAutomationSchedule(input.schedule);

  if (!schedule.enabled) {
    return {
      status: 'disabled',
      acceptedOrders: [],
      blockedOrders: [],
      auditRecords: [],
    };
  }

  const routed = input.signals.map((signal) =>
    routeOrderIntentThroughRiskGate({
      intent: createPlatformOrderIntent({
        source: signal.signalSource,
        strategyId: signal.strategyId || schedule.strategyId,
        symbol: signal.symbol,
        assetClass: signal.assetClass,
        side: signal.side,
        quantity: signal.quantity,
        orderType: signal.orderType,
        timeInForce: signal.timeInForce,
        limitPrice: signal.limitPrice,
        stopPrice: signal.stopPrice,
        marketPrice: signal.marketPrice,
        generatedAt: signal.generatedAt,
        metadata: signal.metadata,
        option: signal.option,
      }),
      broker: input.broker,
      userId: input.userId,
      account: input.account,
      positions: input.positions,
      openOrders: input.openOrders,
      strategy: input.strategy,
      riskSettings: input.riskSettings,
    }),
  );
  const acceptedOrders = routed
    .filter((item) => item.shouldSubmit)
    .map((item) => item.order);
  const blockedOrders = routed
    .filter((item) => !item.shouldSubmit)
    .map((item) => item.order);

  return {
    status: acceptedOrders.length > 0 ? 'ready' : blockedOrders.length > 0 ? 'blocked' : 'not_due',
    acceptedOrders,
    blockedOrders,
    auditRecords: routed.map((item) => item.auditRecord),
  };
}

import type {
  NormalizedBrokerAccount,
  NormalizedBrokerConnection,
  NormalizedBrokerOrder,
  NormalizedBrokerPosition,
} from './brokerModels.ts';
import type { RiskSettings, RiskStrategyConfig } from './riskEngine.ts';
import {
  createOrderLifecycleFromSignal,
  type PlatformOrderLifecycle,
  type StrategySignal,
} from './orderLifecycle.ts';

type PlatformOrderSource = StrategySignal['signalSource'] | 'manual' | 'trade_assistant';

export interface PlatformOrderIntent {
  source: PlatformOrderSource;
  strategyId?: string;
  symbol: string;
  assetClass: StrategySignal['assetClass'];
  side: StrategySignal['side'];
  quantity: number;
  orderType?: StrategySignal['orderType'];
  timeInForce?: StrategySignal['timeInForce'];
  limitPrice?: number;
  stopPrice?: number;
  marketPrice?: number;
  generatedAt: string;
  metadata?: Record<string, any>;
  option?: StrategySignal['option'];
}

export interface RiskGateInput {
  intent: PlatformOrderIntent;
  broker: NormalizedBrokerConnection;
  userId: string;
  account: Pick<NormalizedBrokerAccount, 'equity' | 'buyingPower' | 'dayChange' | 'dayChangePercent' | 'notionalExposure'>;
  positions: Array<Pick<NormalizedBrokerPosition, 'symbol' | 'quantity' | 'marketValue' | 'unrealizedPnL'>>;
  openOrders: Array<Pick<NormalizedBrokerOrder, 'id' | 'symbol' | 'side' | 'status' | 'quantity' | 'averageFillPrice'>>;
  strategy?: RiskStrategyConfig;
  riskSettings?: RiskSettings;
}

export function createPlatformOrderIntent(input: PlatformOrderIntent): PlatformOrderIntent {
  return {
    ...input,
    symbol: String(input.symbol || '').trim().toUpperCase(),
    assetClass: input.assetClass || 'equity',
    orderType: input.orderType || 'market',
    timeInForce: input.timeInForce || 'day',
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}

function intentToSignal(intent: PlatformOrderIntent): StrategySignal {
  return {
    strategyId: intent.strategyId,
    symbol: intent.symbol,
    assetClass: intent.assetClass,
    side: intent.side,
    quantity: intent.quantity,
    orderType: intent.orderType,
    timeInForce: intent.timeInForce,
    limitPrice: intent.limitPrice,
    stopPrice: intent.stopPrice,
    marketPrice: intent.marketPrice,
    signalSource: intent.source,
    generatedAt: intent.generatedAt,
    metadata: intent.metadata,
    option: intent.option,
  };
}

export function routeOrderIntentThroughRiskGate(input: RiskGateInput): ReturnType<typeof createOrderLifecycleFromSignal> & {
  shouldSubmit: boolean;
  submissionReason: string;
  order: PlatformOrderLifecycle;
} {
  const routed = createOrderLifecycleFromSignal({
    signal: intentToSignal(createPlatformOrderIntent(input.intent)),
    broker: input.broker,
    userId: input.userId,
    account: input.account,
    positions: input.positions,
    openOrders: input.openOrders,
    strategy: input.strategy,
    riskSettings: input.riskSettings,
  });
  const shouldSubmit = routed.riskDecision.status !== 'block';

  return {
    ...routed,
    decision: routed.riskDecision,
    shouldSubmit,
    submissionReason: shouldSubmit ? 'risk_gate_passed' : 'risk_gate_blocked',
  } as ReturnType<typeof createOrderLifecycleFromSignal> & {
    decision: typeof routed.riskDecision;
    shouldSubmit: boolean;
    submissionReason: string;
    order: PlatformOrderLifecycle;
  };
}

import type {
  NormalizedBrokerAccount,
  NormalizedBrokerConnection,
  NormalizedBrokerOrder,
  NormalizedBrokerPosition,
} from './brokerModels.ts';
import {
  createRiskAuditRecord,
  evaluateRisk,
  type RiskAuditRecord,
  type RiskDecision,
  type RiskOrderRequest,
  type RiskSettings,
  type RiskStrategyConfig,
} from './riskEngine.ts';

type AssetClass = 'equity' | 'option' | 'crypto';
type OrderSource = 'manual' | 'webhook' | 'trade_assistant' | 'python-strategy-runner';
type OrderStatus = 'pending_risk' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected';
type OptionType = 'call' | 'put';
type LegSide = 'buy' | 'sell';
type TimeInForce = 'day' | 'gtc' | 'gtd' | 'ioc' | 'fok';

export interface OrderLeg {
  id: string;
  assetClass: AssetClass;
  symbol: string;
  side: LegSide;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  contractMultiplier: number;
  underlyingSymbol?: string;
  expirationDate?: string;
  strikePrice?: number;
  optionType?: OptionType;
}

export interface AdvancedOrderInstructions {
  orderType?: 'market' | 'limit' | 'stop' | 'stop_limit';
  orderClass?: 'simple' | 'bracket' | 'oco' | 'trailing_stop';
  timeInForce?: TimeInForce;
  goodTillDate?: string;
  takeProfit?: { limitPrice: number };
  stopLoss?: { stopPrice: number; limitPrice?: number };
  trailingStop?: { trailPrice?: number; trailPercent?: number };
}

export interface OrderLifecycleEvent {
  id: string;
  type: 'created' | 'accepted' | 'partial_fill' | 'filled' | 'canceled' | 'rejected' | 'reconciled';
  status: OrderStatus;
  occurredAt: string;
  details?: Record<string, any>;
}

export interface PlatformOrderLifecycle {
  id: string;
  brokerId: string;
  strategyId?: string;
  source: OrderSource;
  assetClass: AssetClass;
  instrumentType: 'equity' | 'single_leg_option' | 'multi_leg_option' | 'crypto';
  status: OrderStatus;
  legs: OrderLeg[];
  instructions: Required<Pick<AdvancedOrderInstructions, 'orderType' | 'orderClass' | 'timeInForce'>> &
    Omit<AdvancedOrderInstructions, 'orderType' | 'orderClass' | 'timeInForce'>;
  filledQuantity: number;
  averageFillPrice: number;
  estimatedNotional: number;
  capabilityWarnings: string[];
  lifecycleEvents: OrderLifecycleEvent[];
  rawSignal?: StrategySignal;
}

export interface BrokerExecutionUpdate {
  id: string;
  brokerOrderId?: string;
  legId?: string;
  status: string;
  filledQuantity: number;
  averageFillPrice: number;
  occurredAt: string;
}

export interface StrategySignal {
  strategyId?: string;
  symbol: string;
  assetClass?: AssetClass;
  side: LegSide;
  quantity: number;
  orderType?: RiskOrderRequest['orderType'];
  timeInForce?: TimeInForce;
  limitPrice?: number;
  stopPrice?: number;
  marketPrice?: number;
  signalSource: OrderSource;
  generatedAt: string;
  metadata?: Record<string, any>;
  option?: {
    underlyingSymbol: string;
    expirationDate: string;
    strikePrice: number;
    optionType: OptionType;
  };
}

export interface SignalLifecycleInput {
  signal: StrategySignal;
  broker: NormalizedBrokerConnection;
  userId: string;
  account: Pick<NormalizedBrokerAccount, 'equity' | 'buyingPower' | 'dayChange' | 'dayChangePercent' | 'notionalExposure'>;
  positions: Array<Pick<NormalizedBrokerPosition, 'symbol' | 'quantity' | 'marketValue' | 'unrealizedPnL'>>;
  openOrders: Array<Pick<NormalizedBrokerOrder, 'id' | 'symbol' | 'side' | 'status' | 'quantity' | 'averageFillPrice'>>;
  strategy?: RiskStrategyConfig;
  riskSettings?: RiskSettings;
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toFiniteNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeSymbol(value: string) {
  return String(value || '').trim().toUpperCase();
}

function formatOccDate(expirationDate: string) {
  const [year, month, day] = expirationDate.split('-');
  if (!year || !month || !day) {
    throw new Error('Option expirationDate must use YYYY-MM-DD format.');
  }

  return `${year.slice(2)}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
}

function formatOccStrike(strikePrice: number) {
  return String(Math.round(strikePrice * 1000)).padStart(8, '0');
}

function estimateLegNotional(leg: OrderLeg) {
  const price = Math.max(toFiniteNumber(leg.limitPrice), toFiniteNumber(leg.stopPrice));
  return Math.abs(toFiniteNumber(leg.quantity)) * price * leg.contractMultiplier;
}

function estimateOrderNotional(legs: OrderLeg[]) {
  return legs.reduce((total, leg) => total + estimateLegNotional(leg), 0);
}

function buildLifecycleEvent(
  type: OrderLifecycleEvent['type'],
  status: OrderStatus,
  occurredAt: string,
  details?: Record<string, any>,
): OrderLifecycleEvent {
  return {
    id: createId('event'),
    type,
    status,
    occurredAt,
    details,
  };
}

function resolveInstrumentType(legs: OrderLeg[]): PlatformOrderLifecycle['instrumentType'] {
  if (legs.some((leg) => leg.assetClass === 'option')) {
    return legs.length > 1 ? 'multi_leg_option' : 'single_leg_option';
  }

  if (legs.some((leg) => leg.assetClass === 'crypto')) {
    return 'crypto';
  }

  return 'equity';
}

function resolveAssetClass(legs: OrderLeg[]): AssetClass {
  if (legs.some((leg) => leg.assetClass === 'option')) return 'option';
  if (legs.some((leg) => leg.assetClass === 'crypto')) return 'crypto';
  return 'equity';
}

export function createOptionLeg(input: {
  underlyingSymbol: string;
  expirationDate: string;
  strikePrice: number;
  optionType: OptionType;
  side: LegSide;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}): OrderLeg {
  const underlyingSymbol = normalizeSymbol(input.underlyingSymbol);
  const optionCode = input.optionType === 'call' ? 'C' : 'P';

  return {
    id: createId('leg'),
    assetClass: 'option',
    symbol: `${underlyingSymbol}${formatOccDate(input.expirationDate)}${optionCode}${formatOccStrike(input.strikePrice)}`,
    side: input.side,
    quantity: toFiniteNumber(input.quantity),
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
    contractMultiplier: 100,
    underlyingSymbol,
    expirationDate: input.expirationDate,
    strikePrice: input.strikePrice,
    optionType: input.optionType,
  };
}

export function createEquityLeg(input: {
  symbol: string;
  side: LegSide;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  marketPrice?: number;
}): OrderLeg {
  return {
    id: createId('leg'),
    assetClass: 'equity',
    symbol: normalizeSymbol(input.symbol),
    side: input.side,
    quantity: toFiniteNumber(input.quantity),
    limitPrice: input.limitPrice ?? input.marketPrice,
    stopPrice: input.stopPrice,
    contractMultiplier: 1,
  };
}

export function buildAdvancedOrderSupportMatrix(
  broker: NormalizedBrokerConnection,
  order?: Pick<PlatformOrderLifecycle, 'instrumentType' | 'instructions'>,
) {
  const supportsOptions = broker.capabilities.supportsOptions;
  const supportsBracketOrders = broker.capabilities.supportsBracketOrders;
  const supportsTrailingStops = broker.capabilities.supportsTrailingStops;

  return {
    supportsOptions,
    supportsMultiLegOptions: supportsOptions && ['alpaca', 'interactive_brokers'].includes(broker.provider),
    supportsOco: supportsBracketOrders,
    supportsBracketOrders,
    supportsTrailingStops,
    supportsGtd: broker.provider === 'interactive_brokers',
    supportsIoc: broker.provider === 'interactive_brokers',
    supportsFok: broker.provider === 'interactive_brokers',
    warnings: order ? capabilityWarningsForOrder(broker, order) : [],
  };
}

function capabilityWarningsForOrder(
  broker: NormalizedBrokerConnection,
  order: Pick<PlatformOrderLifecycle, 'instrumentType' | 'instructions'>,
) {
  const support = buildAdvancedOrderSupportMatrix(broker);
  const warnings: string[] = [];

  if (order.instrumentType.includes('option') && !support.supportsOptions) {
    warnings.push('broker_does_not_support_options');
  }

  if (order.instrumentType === 'multi_leg_option' && !support.supportsMultiLegOptions) {
    warnings.push('broker_does_not_support_multi_leg_options');
  }

  if (order.instructions.orderClass === 'bracket' && !support.supportsBracketOrders) {
    warnings.push('broker_does_not_support_bracket_orders');
  }

  if (order.instructions.orderClass === 'oco' && !support.supportsOco) {
    warnings.push('broker_does_not_support_oco_orders');
  }

  if (order.instructions.orderClass === 'trailing_stop' && !support.supportsTrailingStops) {
    warnings.push('broker_does_not_support_trailing_stops');
  }

  if (order.instructions.timeInForce === 'gtd' && !support.supportsGtd) {
    warnings.push('broker_does_not_support_gtd');
  }

  if (order.instructions.timeInForce === 'ioc' && !support.supportsIoc) {
    warnings.push('broker_does_not_support_ioc');
  }

  if (order.instructions.timeInForce === 'fok' && !support.supportsFok) {
    warnings.push('broker_does_not_support_fok');
  }

  return warnings;
}

export function createOrderLifecycle(input: {
  broker: NormalizedBrokerConnection;
  source: OrderSource;
  strategyId?: string;
  generatedAt?: string;
  legs: OrderLeg[];
  instructions?: AdvancedOrderInstructions;
  rawSignal?: StrategySignal;
}): PlatformOrderLifecycle {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const instructions = {
    orderType: input.instructions?.orderType || 'market',
    orderClass: input.instructions?.orderClass || 'simple',
    timeInForce: input.instructions?.timeInForce || 'day',
    goodTillDate: input.instructions?.goodTillDate,
    takeProfit: input.instructions?.takeProfit,
    stopLoss: input.instructions?.stopLoss,
    trailingStop: input.instructions?.trailingStop,
  };
  const assetClass = resolveAssetClass(input.legs);
  const instrumentType = resolveInstrumentType(input.legs);
  const orderShape = { instrumentType, instructions };

  return {
    id: createId('oms'),
    brokerId: input.broker.id,
    strategyId: input.strategyId,
    source: input.source,
    assetClass,
    instrumentType,
    status: 'pending_risk',
    legs: input.legs,
    instructions,
    filledQuantity: 0,
    averageFillPrice: 0,
    estimatedNotional: estimateOrderNotional(input.legs),
    capabilityWarnings: capabilityWarningsForOrder(input.broker, orderShape),
    lifecycleEvents: [buildLifecycleEvent('created', 'pending_risk', generatedAt, {
      brokerId: input.broker.id,
      source: input.source,
    })],
    rawSignal: input.rawSignal,
  };
}

export function reconcileOrderLifecycle(
  order: PlatformOrderLifecycle,
  updates: BrokerExecutionUpdate[],
): PlatformOrderLifecycle {
  const totalFilledQuantity = updates.reduce(
    (total, update) => total + Math.max(0, toFiniteNumber(update.filledQuantity)),
    0,
  );
  const totalFillValue = updates.reduce(
    (total, update) =>
      total + Math.max(0, toFiniteNumber(update.filledQuantity)) * toFiniteNumber(update.averageFillPrice),
    0,
  );
  const totalRequestedQuantity = order.legs.reduce(
    (total, leg) => total + Math.abs(toFiniteNumber(leg.quantity)),
    0,
  );
  const latestTerminalStatus = updates.find((update) =>
    ['canceled', 'cancelled', 'rejected'].includes(String(update.status).toLowerCase()),
  );
  const averageFillPrice = totalFilledQuantity > 0 ? totalFillValue / totalFilledQuantity : 0;
  let status: OrderStatus = order.status;
  let eventType: OrderLifecycleEvent['type'] = 'reconciled';

  if (latestTerminalStatus) {
    status = String(latestTerminalStatus.status).toLowerCase() === 'rejected' ? 'rejected' : 'canceled';
    eventType = status;
  } else if (totalFilledQuantity >= totalRequestedQuantity && totalRequestedQuantity > 0) {
    status = 'filled';
    eventType = 'filled';
  } else if (totalFilledQuantity > 0) {
    status = 'partially_filled';
    eventType = 'partial_fill';
  }

  const occurredAt = updates[updates.length - 1]?.occurredAt || new Date().toISOString();

  return {
    ...order,
    status,
    filledQuantity: totalFilledQuantity,
    averageFillPrice,
    lifecycleEvents: [
      ...order.lifecycleEvents,
      buildLifecycleEvent(eventType, status, occurredAt, { updates }),
    ],
  };
}

function signalToLeg(signal: StrategySignal): OrderLeg {
  if (signal.assetClass === 'option' && signal.option) {
    return createOptionLeg({
      ...signal.option,
      side: signal.side,
      quantity: signal.quantity,
      limitPrice: signal.limitPrice ?? signal.marketPrice,
      stopPrice: signal.stopPrice,
    });
  }

  return createEquityLeg({
    symbol: signal.symbol,
    side: signal.side,
    quantity: signal.quantity,
    limitPrice: signal.limitPrice,
    stopPrice: signal.stopPrice,
    marketPrice: signal.marketPrice,
  });
}

function signalToRiskOrder(signal: StrategySignal, leg: OrderLeg): RiskOrderRequest {
  const price = signal.limitPrice ?? signal.stopPrice ?? signal.marketPrice;
  const adjustedPrice = signal.assetClass === 'option' && price != null
    ? price * leg.contractMultiplier
    : price;

  return {
    symbol: leg.symbol,
    side: signal.side,
    quantity: signal.quantity,
    orderType: signal.orderType,
    assetClass: signal.assetClass || leg.assetClass,
    limitPrice: signal.limitPrice != null ? adjustedPrice : undefined,
    stopPrice: signal.stopPrice != null ? adjustedPrice : undefined,
    marketPrice: signal.marketPrice != null ? adjustedPrice : undefined,
    requestedAt: signal.generatedAt,
  };
}

export function createOrderLifecycleFromSignal(input: SignalLifecycleInput): {
  order: PlatformOrderLifecycle;
  riskDecision: RiskDecision;
  auditRecord: RiskAuditRecord;
} {
  const leg = signalToLeg(input.signal);
  const order = createOrderLifecycle({
    broker: input.broker,
    source: input.signal.signalSource,
    strategyId: input.signal.strategyId,
    generatedAt: input.signal.generatedAt,
    legs: [leg],
    instructions: {
      orderType: input.signal.orderType || 'market',
      timeInForce: input.signal.timeInForce || 'day',
    },
    rawSignal: input.signal,
  });
  const riskOrder = signalToRiskOrder(input.signal, leg);
  const riskDecision = evaluateRisk({
    userId: input.userId,
    order: riskOrder,
    broker: input.broker,
    account: input.account,
    positions: input.positions,
    openOrders: input.openOrders,
    strategy: input.strategy,
    riskSettings: input.riskSettings,
  });
  const status = riskDecision.status === 'block' ? 'rejected' : 'accepted';
  const auditRecord = createRiskAuditRecord({
    userId: input.userId,
    source: input.signal.signalSource,
    brokerId: input.broker.id,
    order: riskOrder,
    decision: riskDecision,
    createdAt: input.signal.generatedAt,
  });

  return {
    order: {
      ...order,
      status,
      lifecycleEvents: [
        ...order.lifecycleEvents,
        buildLifecycleEvent(status, status, input.signal.generatedAt, {
          riskStatus: riskDecision.status,
          issueCodes: riskDecision.issues.map((issue) => issue.code),
        }),
      ],
    },
    riskDecision,
    auditRecord,
  };
}

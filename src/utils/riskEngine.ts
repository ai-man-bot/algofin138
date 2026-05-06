import type {
  NormalizedBrokerAccount,
  NormalizedBrokerConnection,
  NormalizedBrokerOrder,
  NormalizedBrokerPosition,
} from './brokerModels.ts';

type RiskStatus = 'allow' | 'warn' | 'block';
type RiskAssetClass = 'equity' | 'option' | 'crypto';

export interface RiskIssue {
  code: string;
  severity: Exclude<RiskStatus, 'allow'>;
  message: string;
  details?: Record<string, any>;
}

export interface RiskStrategyConfig {
  id?: string;
  name?: string;
  maxPositionSize?: number | null;
  maxNotionalExposure?: number | null;
  maxDailyLoss?: number | null;
  restrictedSymbols?: string[] | null;
  allowedSymbols?: string[] | null;
}

export interface RiskSettings {
  killSwitchEnabled?: boolean;
  authorizedUserIds?: string[] | null;
}

export interface RiskOrderRequest {
  symbol: string;
  side: string;
  quantity: number;
  orderType?: string;
  assetClass?: RiskAssetClass;
  limitPrice?: number;
  stopPrice?: number;
  marketPrice?: number;
  requestedAt?: string;
}

export interface RiskEvaluationInput {
  userId: string;
  order: RiskOrderRequest;
  broker?: Pick<NormalizedBrokerConnection, 'id' | 'provider' | 'capabilities'>;
  account: Pick<NormalizedBrokerAccount, 'equity' | 'buyingPower' | 'dayChange' | 'dayChangePercent' | 'notionalExposure'>;
  positions: Array<Pick<NormalizedBrokerPosition, 'symbol' | 'quantity' | 'marketValue' | 'unrealizedPnL'>>;
  openOrders: Array<Pick<NormalizedBrokerOrder, 'id' | 'symbol' | 'side' | 'status' | 'quantity' | 'averageFillPrice'>>;
  strategy?: RiskStrategyConfig;
  riskSettings?: RiskSettings;
}

export interface RiskDecision {
  status: RiskStatus;
  issues: RiskIssue[];
  summary: string;
  estimatedOrderNotional: number;
  projectedNotionalExposure: number;
}

export interface RiskAuditRecord {
  id: string;
  userId: string;
  source: string;
  brokerId: string | null;
  status: RiskStatus;
  summary: string;
  issueCodes: string[];
  issues: RiskIssue[];
  estimatedOrderNotional: number;
  projectedNotionalExposure: number;
  order: RiskOrderRequest;
  createdAt: string;
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

function normalizeSymbol(value: string | undefined) {
  return String(value || '').trim().toUpperCase();
}

function averagePortfolioPrice(positions: RiskEvaluationInput['positions']) {
  const totals = positions.reduce((acc, position) => {
    const quantity = Math.abs(toFiniteNumber(position.quantity));
    const marketValue = Math.abs(toFiniteNumber(position.marketValue));
    return {
      quantity: acc.quantity + quantity,
      marketValue: acc.marketValue + marketValue,
    };
  }, { quantity: 0, marketValue: 0 });

  if (totals.quantity === 0 || totals.marketValue === 0) {
    return 0;
  }

  return totals.marketValue / totals.quantity;
}

function estimateOrderNotional(input: RiskEvaluationInput) {
  const directPrice = Math.max(
    toFiniteNumber(input.order.limitPrice),
    toFiniteNumber(input.order.stopPrice),
    toFiniteNumber(input.order.marketPrice),
  );

  if (directPrice > 0) {
    return directPrice * Math.abs(toFiniteNumber(input.order.quantity));
  }

  const matchingOpenOrder = input.openOrders.find((order) =>
    normalizeSymbol(order.symbol) === normalizeSymbol(input.order.symbol) &&
    toFiniteNumber(order.averageFillPrice) > 0,
  );

  if (matchingOpenOrder) {
    return toFiniteNumber(matchingOpenOrder.averageFillPrice) * Math.abs(toFiniteNumber(input.order.quantity));
  }

  const matchingPosition = input.positions.find((position) =>
    normalizeSymbol(position.symbol) === normalizeSymbol(input.order.symbol) &&
    toFiniteNumber(position.marketValue) > 0 &&
    toFiniteNumber(position.quantity) > 0,
  );

  if (matchingPosition) {
    return (toFiniteNumber(matchingPosition.marketValue) / toFiniteNumber(matchingPosition.quantity))
      * Math.abs(toFiniteNumber(input.order.quantity));
  }

  return averagePortfolioPrice(input.positions) * Math.abs(toFiniteNumber(input.order.quantity));
}

function buildIssue(
  code: string,
  severity: 'warn' | 'block',
  message: string,
  details?: Record<string, any>,
): RiskIssue {
  return { code, severity, message, details };
}

export function evaluateRisk(input: RiskEvaluationInput): RiskDecision {
  const issues: RiskIssue[] = [];
  const symbol = normalizeSymbol(input.order.symbol);
  const strategy = input.strategy || {};
  const riskSettings = input.riskSettings || {};
  const estimatedOrderNotional = estimateOrderNotional(input);
  const projectedNotionalExposure = toFiniteNumber(input.account.notionalExposure) + estimatedOrderNotional;
  const authorizedUserIds = (riskSettings.authorizedUserIds || []).filter(Boolean);

  if (riskSettings.killSwitchEnabled) {
    issues.push(buildIssue('kill_switch', 'block', 'Account-wide kill switch is enabled.'));
  }

  if (authorizedUserIds.length > 0 && !authorizedUserIds.includes(input.userId)) {
    issues.push(buildIssue('unauthorized_user', 'block', 'User is not authorized to submit orders for this risk profile.', {
      userId: input.userId,
    }));
  }

  const assetClass = input.order.assetClass || 'equity';
  const capabilities = input.broker?.capabilities;
  if (
    capabilities &&
    (
      (assetClass === 'equity' && !capabilities.supportsEquities) ||
      (assetClass === 'option' && !capabilities.supportsOptions) ||
      (assetClass === 'crypto' && !capabilities.supportsCrypto)
    )
  ) {
    issues.push(buildIssue('unsupported_asset_class', 'block', `${input.broker?.provider || 'Broker'} does not support ${assetClass} orders.`, {
      assetClass,
      brokerId: input.broker?.id,
    }));
  }

  if (
    String(input.order.side || '').toLowerCase() === 'buy' &&
    estimatedOrderNotional > toFiniteNumber(input.account.buyingPower)
  ) {
    issues.push(buildIssue('insufficient_buying_power', 'block', 'Order notional exceeds available buying power.', {
      estimatedOrderNotional,
      buyingPower: input.account.buyingPower,
    }));
  }

  const restrictedSymbols = (strategy.restrictedSymbols || []).map(normalizeSymbol);
  if (restrictedSymbols.includes(symbol)) {
    issues.push(buildIssue('restricted_symbol', 'block', `${symbol} is restricted for this strategy.`, { symbol }));
  }

  const allowedSymbols = (strategy.allowedSymbols || []).map(normalizeSymbol).filter(Boolean);
  if (allowedSymbols.length > 0 && !allowedSymbols.includes(symbol)) {
    issues.push(buildIssue('symbol_not_allowed', 'block', `${symbol} is outside the strategy allowlist.`, { symbol }));
  }

  const duplicateOrder = input.openOrders.find((order) =>
    normalizeSymbol(order.symbol) === symbol &&
    String(order.side || '').toLowerCase() === String(input.order.side || '').toLowerCase() &&
    ['accepted', 'held', 'new', 'partially_filled', 'pending_cancel', 'pending_new', 'pending_replace'].includes(String(order.status || '').toLowerCase()),
  );

  if (duplicateOrder) {
    issues.push(buildIssue('duplicate_order', 'warn', 'A matching open order already exists.', {
      orderId: duplicateOrder.id,
      symbol,
    }));
  }

  const maxDailyLoss = toFiniteNumber(strategy.maxDailyLoss);
  if (maxDailyLoss > 0 && toFiniteNumber(input.account.dayChange) <= -Math.abs(maxDailyLoss)) {
    issues.push(buildIssue('max_daily_loss', 'warn', 'Daily loss threshold has been breached.', {
      dayChange: input.account.dayChange,
      maxDailyLoss,
    }));
  }

  const maxPositionSize = toFiniteNumber(strategy.maxPositionSize);
  if (maxPositionSize > 0 && estimatedOrderNotional >= maxPositionSize) {
    issues.push(buildIssue('max_position_size', 'warn', 'Projected order notional exceeds the strategy position cap.', {
      estimatedOrderNotional,
      maxPositionSize,
    }));
  }

  const maxNotionalExposure = toFiniteNumber(strategy.maxNotionalExposure);
  if (maxNotionalExposure > 0 && projectedNotionalExposure >= maxNotionalExposure) {
    issues.push(buildIssue('max_notional_exposure', 'warn', 'Projected exposure meets or exceeds the notional exposure cap.', {
      projectedNotionalExposure,
      maxNotionalExposure,
    }));
  }

  const status: RiskStatus = issues.some((issue) => issue.severity === 'block')
    ? 'block'
    : issues.length > 0
      ? 'warn'
      : 'allow';

  return {
    status,
    issues,
    summary: issues.length > 0
      ? issues.map((issue) => issue.code).join(', ')
      : 'allow',
    estimatedOrderNotional,
    projectedNotionalExposure,
  };
}

export function createRiskAuditRecord(input: {
  userId: string;
  source: string;
  brokerId?: string | null;
  order: RiskOrderRequest;
  decision: RiskDecision;
  createdAt?: string;
}): RiskAuditRecord {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    source: input.source,
    brokerId: input.brokerId || null,
    status: input.decision.status,
    summary: input.decision.summary,
    issueCodes: input.decision.issues.map((issue) => issue.code),
    issues: input.decision.issues,
    estimatedOrderNotional: input.decision.estimatedOrderNotional,
    projectedNotionalExposure: input.decision.projectedNotionalExposure,
    order: input.order,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

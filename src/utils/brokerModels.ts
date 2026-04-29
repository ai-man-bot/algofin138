type NumericLike = number | string | null | undefined;

export type BrokerProvider = 'alpaca' | 'interactive_brokers' | 'manual' | 'unknown';
export type BrokerConnectionStatus = 'connected' | 'disconnected';

export interface BrokerCapabilities {
  supportsEquities: boolean;
  supportsOptions: boolean;
  supportsCrypto: boolean;
  supportsFractionalShares: boolean;
  supportsBracketOrders: boolean;
  supportsTrailingStops: boolean;
  supportsStreamingData: boolean;
}

export interface NormalizedBrokerConnection {
  id: string;
  provider: BrokerProvider;
  brokerType: string;
  name: string;
  accountId: string;
  status: BrokerConnectionStatus;
  connected: boolean;
  connectedAt: string | null;
  capabilities: BrokerCapabilities;
  raw: any;
}

export interface NormalizedBrokerAccount {
  equity: number;
  lastEquity: number;
  buyingPower: number;
  cash: number;
  dayChange: number;
  dayChangePercent: number;
  notionalExposure: number;
  raw: any;
}

export interface NormalizedBrokerPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  intradayPnL: number;
  intradayPnLPercent: number;
  raw: any;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  unrealized_intraday_pl: number;
  unrealized_intraday_plpc: number;
}

export interface NormalizedBrokerOrder {
  id: string;
  symbol: string;
  side: string;
  status: string;
  orderType: string;
  timeInForce: string;
  quantity: number;
  filledQuantity: number;
  averageFillPrice: number;
  limitPrice: number;
  stopPrice: number;
  submittedAt: string | null;
  filledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  estimatedNotional: number;
  isOpen: boolean;
  isFilled: boolean;
  raw: any;
  qty: number;
  filled_qty: number;
  filled_avg_price: number;
  limit_price: number;
  stop_price: number;
  type: string;
  order_type: string;
  submitted_at: string | null;
  filled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function toNumber(value: NumericLike, fallback = 0) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toPercent(value: NumericLike) {
  const numeric = toNumber(value, 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

function resolveBrokerProvider(broker: any): BrokerProvider {
  const type = String(broker?.brokerType || broker?.provider || broker?.id || '')
    .toLowerCase()
    .trim();

  if (type.includes('alpaca')) return 'alpaca';
  if (type.includes('interactive') || type.includes('ibkr') || type.includes('ib')) {
    return 'interactive_brokers';
  }
  if (type.includes('manual')) return 'manual';
  return 'unknown';
}

function buildBrokerCapabilities(provider: BrokerProvider): BrokerCapabilities {
  if (provider === 'alpaca') {
    return {
      supportsEquities: true,
      supportsOptions: false,
      supportsCrypto: false,
      supportsFractionalShares: true,
      supportsBracketOrders: true,
      supportsTrailingStops: true,
      supportsStreamingData: true,
    };
  }

  if (provider === 'interactive_brokers') {
    return {
      supportsEquities: true,
      supportsOptions: true,
      supportsCrypto: false,
      supportsFractionalShares: true,
      supportsBracketOrders: true,
      supportsTrailingStops: true,
      supportsStreamingData: true,
    };
  }

  return {
    supportsEquities: false,
    supportsOptions: false,
    supportsCrypto: false,
    supportsFractionalShares: false,
    supportsBracketOrders: false,
    supportsTrailingStops: false,
    supportsStreamingData: false,
  };
}

export function normalizeBrokerConnection(broker: any): NormalizedBrokerConnection {
  const provider = resolveBrokerProvider(broker);
  const connected = Boolean(broker?.connected);

  return {
    id: String(broker?.id || `${provider}:unknown`),
    provider,
    brokerType: String(broker?.brokerType || provider),
    name: String(broker?.name || broker?.displayName || broker?.id || 'Broker'),
    accountId: String(broker?.accountId || broker?.account_id || ''),
    status: connected ? 'connected' : 'disconnected',
    connected,
    connectedAt: broker?.connectedAt || broker?.connected_at || null,
    capabilities: buildBrokerCapabilities(provider),
    raw: broker,
  };
}

export function normalizeBrokerConnections(brokers: any[] = []) {
  return Array.isArray(brokers) ? brokers.map(normalizeBrokerConnection) : [];
}

export function normalizeAlpacaAccount(account: any): NormalizedBrokerAccount {
  const equity = toNumber(account?.equity);
  const lastEquity = toNumber(account?.last_equity ?? account?.lastEquity);
  const buyingPower = toNumber(account?.buying_power ?? account?.buyingPower);
  const cash = toNumber(account?.cash);
  const dayChange = toNumber(account?.dayChange, equity - lastEquity);
  const dayChangePercent = lastEquity !== 0
    ? (dayChange / lastEquity) * 100
    : 0;
  const longMarketValue = toNumber(account?.long_market_value);
  const shortMarketValue = Math.abs(toNumber(account?.short_market_value));
  const notionalExposure = toNumber(
    account?.notionalExposure,
    longMarketValue + shortMarketValue,
  );

  return {
    equity,
    lastEquity,
    buyingPower,
    cash,
    dayChange,
    dayChangePercent,
    notionalExposure,
    raw: account,
  };
}

export function normalizeAlpacaPosition(position: any): NormalizedBrokerPosition {
  const quantitySigned = toNumber(position?.qty ?? position?.quantity);
  const quantity = Math.abs(quantitySigned);
  const side = quantitySigned < 0 || String(position?.side || '').toLowerCase() === 'short'
    ? 'short'
    : 'long';
  const averageEntryPrice = toNumber(position?.avg_entry_price ?? position?.averageEntryPrice);
  const currentPrice = toNumber(position?.current_price ?? position?.currentPrice);
  const marketValue = toNumber(position?.market_value ?? position?.marketValue);
  const costBasis = toNumber(position?.cost_basis ?? position?.costBasis);
  const unrealizedPnL = toNumber(position?.unrealized_pl ?? position?.unrealizedPnL);
  const intradayPnL = toNumber(position?.unrealized_intraday_pl ?? position?.intradayPnL);
  const unrealizedRawPercent = toNumber(position?.unrealized_plpc ?? position?.unrealizedPnLPercent);
  const intradayRawPercent = toNumber(position?.unrealized_intraday_plpc ?? position?.intradayPnLPercent);

  return {
    id: String(position?.asset_id || position?.symbol || crypto.randomUUID()),
    symbol: String(position?.symbol || '').toUpperCase(),
    side,
    quantity,
    averageEntryPrice,
    currentPrice,
    marketValue,
    costBasis,
    unrealizedPnL,
    unrealizedPnLPercent: toPercent(unrealizedRawPercent),
    intradayPnL,
    intradayPnLPercent: toPercent(intradayRawPercent),
    raw: position,
    qty: quantitySigned || quantity,
    avg_entry_price: averageEntryPrice,
    current_price: currentPrice,
    market_value: marketValue,
    cost_basis: costBasis,
    unrealized_pl: unrealizedPnL,
    unrealized_plpc: Math.abs(unrealizedRawPercent) <= 1 ? unrealizedRawPercent : unrealizedRawPercent / 100,
    unrealized_intraday_pl: intradayPnL,
    unrealized_intraday_plpc: Math.abs(intradayRawPercent) <= 1 ? intradayRawPercent : intradayRawPercent / 100,
  };
}

export function normalizeAlpacaPositions(positions: any[] = []) {
  return Array.isArray(positions) ? positions.map(normalizeAlpacaPosition) : [];
}

const OPEN_ORDER_STATUSES = new Set([
  'accepted',
  'held',
  'new',
  'partially_filled',
  'pending_cancel',
  'pending_new',
  'pending_replace',
  'accepted_for_bidding',
  'stopped',
  'calculated',
]);

export function isOpenOrderStatus(status: string) {
  return OPEN_ORDER_STATUSES.has(String(status || '').toLowerCase());
}

export function normalizeAlpacaOrder(order: any): NormalizedBrokerOrder {
  const quantity = toNumber(order?.qty ?? order?.quantity);
  const filledQuantity = toNumber(order?.filled_qty ?? order?.filledQuantity);
  const averageFillPrice = toNumber(order?.filled_avg_price ?? order?.averageFillPrice);
  const limitPrice = toNumber(order?.limit_price ?? order?.limitPrice);
  const stopPrice = toNumber(order?.stop_price ?? order?.stopPrice);
  const orderType = String(order?.type || order?.order_type || order?.orderType || 'market').toLowerCase();
  const status = String(order?.status || 'unknown').toLowerCase();
  const estimatedNotional = filledQuantity > 0 && averageFillPrice > 0
    ? filledQuantity * averageFillPrice
    : quantity * Math.max(limitPrice, stopPrice, averageFillPrice, 0);

  return {
    id: String(order?.id || crypto.randomUUID()),
    symbol: String(order?.symbol || '').toUpperCase(),
    side: String(order?.side || '').toLowerCase(),
    status,
    orderType,
    timeInForce: String(order?.time_in_force || order?.timeInForce || 'day').toLowerCase(),
    quantity,
    filledQuantity,
    averageFillPrice,
    limitPrice,
    stopPrice,
    submittedAt: order?.submitted_at || order?.submittedAt || null,
    filledAt: order?.filled_at || order?.filledAt || null,
    createdAt: order?.created_at || order?.createdAt || null,
    updatedAt: order?.updated_at || order?.updatedAt || null,
    estimatedNotional,
    isOpen: isOpenOrderStatus(status),
    isFilled: status === 'filled',
    raw: order,
    qty: quantity,
    filled_qty: filledQuantity,
    filled_avg_price: averageFillPrice,
    limit_price: limitPrice,
    stop_price: stopPrice,
    type: orderType,
    order_type: orderType,
    submitted_at: order?.submitted_at || order?.submittedAt || null,
    filled_at: order?.filled_at || order?.filledAt || null,
    created_at: order?.created_at || order?.createdAt || null,
    updated_at: order?.updated_at || order?.updatedAt || null,
  };
}

export function normalizeAlpacaOrders(orders: any[] = []) {
  return Array.isArray(orders) ? orders.map(normalizeAlpacaOrder) : [];
}

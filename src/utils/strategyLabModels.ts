export type StrategyLabAssetClass = 'equity' | 'crypto' | 'option';
export type StrategyLabDirection = 'long' | 'short' | 'both';
export type StrategyLabBarTimeframe = '1Min' | '5Min' | '15Min' | '1H' | '1D';

export interface StrategyLabIndicatorConfig {
  rsiLength: number;
  emaShort: number;
  emaLong: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
}

export interface StrategyLabRiskConfig {
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
}

export interface StrategyLabPositionSizing {
  type: 'percent_of_equity' | 'fixed_quantity';
  value: number;
}

export interface StrategyLabStrategyDefinition {
  name: string;
  symbol: string;
  assetClass: StrategyLabAssetClass;
  direction: StrategyLabDirection;
  indicators: StrategyLabIndicatorConfig;
  entryRules: unknown[];
  exitRules: unknown[];
  risk: StrategyLabRiskConfig;
  positionSizing: StrategyLabPositionSizing;
  metadata: Record<string, unknown>;
}

export interface StrategyLabQuote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  currency: string;
  source: string;
  timestamp: string;
  bid?: number;
  ask?: number;
}

export interface StrategyLabBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const DEFAULT_INDICATORS: StrategyLabIndicatorConfig = {
  rsiLength: 14,
  emaShort: 20,
  emaLong: 50,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};

const DEFAULT_RISK: StrategyLabRiskConfig = {
  stopLossPct: 3,
  takeProfitPct: 8,
  trailingStopPct: 1.5,
};

const DEFAULT_POSITION_SIZING: StrategyLabPositionSizing = {
  type: 'percent_of_equity',
  value: 5,
};

export function normalizeStrategyLabSymbol(symbol: unknown) {
  return String(symbol || '').trim().toUpperCase();
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertPositive(value: number, label: string) {
  if (!(value > 0)) {
    throw new Error(`${label} must be greater than 0`);
  }
}

export function createStrategyLabStrategyDefinition(input: Partial<StrategyLabStrategyDefinition>): StrategyLabStrategyDefinition {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Strategy name is required');
  }

  const symbol = normalizeStrategyLabSymbol(input.symbol);
  if (!symbol) {
    throw new Error('Strategy symbol is required');
  }

  const indicators = {
    ...DEFAULT_INDICATORS,
    ...(input.indicators || {}),
  };

  if (Math.floor(indicators.rsiLength) < 2) {
    throw new Error('RSI length must be at least 2');
  }
  if (Math.floor(indicators.emaShort) < 2 || Math.floor(indicators.emaLong) < 2) {
    throw new Error('EMA lengths must be at least 2');
  }
  if (Math.floor(indicators.macdFast) < 2 || Math.floor(indicators.macdSlow) < 2 || Math.floor(indicators.macdSignal) < 2) {
    throw new Error('MACD lengths must be at least 2');
  }

  const risk = {
    ...DEFAULT_RISK,
    ...(input.risk || {}),
  };
  assertPositive(risk.stopLossPct, 'Stop loss percent');
  assertPositive(risk.takeProfitPct, 'Take profit percent');
  assertPositive(risk.trailingStopPct, 'Trailing stop percent');

  const positionSizing = {
    ...DEFAULT_POSITION_SIZING,
    ...(input.positionSizing || {}),
  };
  assertPositive(positionSizing.value, 'Position size');

  return {
    name,
    symbol,
    assetClass: input.assetClass || 'equity',
    direction: input.direction || 'long',
    indicators: {
      rsiLength: Math.floor(indicators.rsiLength),
      emaShort: Math.floor(indicators.emaShort),
      emaLong: Math.floor(indicators.emaLong),
      macdFast: Math.floor(indicators.macdFast),
      macdSlow: Math.floor(indicators.macdSlow),
      macdSignal: Math.floor(indicators.macdSignal),
    },
    entryRules: Array.isArray(input.entryRules) ? input.entryRules : [],
    exitRules: Array.isArray(input.exitRules) ? input.exitRules : [],
    risk: {
      stopLossPct: finiteNumber(risk.stopLossPct),
      takeProfitPct: finiteNumber(risk.takeProfitPct),
      trailingStopPct: finiteNumber(risk.trailingStopPct),
    },
    positionSizing: {
      type: positionSizing.type || 'percent_of_equity',
      value: finiteNumber(positionSizing.value),
    },
    metadata: input.metadata || {},
  };
}

export function normalizeStrategyLabQuote(input: Record<string, unknown>): StrategyLabQuote {
  const symbol = normalizeStrategyLabSymbol(input.symbol);
  const price = finiteNumber(input.price);
  const previousClose = finiteNumber(input.previousClose ?? input.previous_close, price);
  const change = Number((price - previousClose).toFixed(6));
  const changePct = previousClose === 0 ? 0 : Number(((change / previousClose) * 100).toFixed(6));

  if (!symbol) {
    throw new Error('Quote symbol is required');
  }
  assertPositive(price, 'Quote price');

  return {
    symbol,
    price,
    previousClose,
    change,
    changePct,
    currency: String(input.currency || 'USD'),
    source: String(input.source || 'unknown'),
    timestamp: String(input.timestamp || new Date().toISOString()),
    bid: input.bid == null ? undefined : finiteNumber(input.bid),
    ask: input.ask == null ? undefined : finiteNumber(input.ask),
  };
}

export function normalizeStrategyLabBar(input: Record<string, unknown>): StrategyLabBar {
  const time = String(input.time ?? input.t ?? '');
  if (!time) {
    throw new Error('Bar time is required');
  }

  return {
    time,
    open: finiteNumber(input.open ?? input.o),
    high: finiteNumber(input.high ?? input.h),
    low: finiteNumber(input.low ?? input.l),
    close: finiteNumber(input.close ?? input.c),
    volume: finiteNumber(input.volume ?? input.v),
  };
}

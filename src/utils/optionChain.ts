export type OptionType = 'call' | 'put';
export type OptionLegSide = 'buy' | 'sell';
export type OptionStrategyType = 'single' | 'vertical' | 'straddle';

export interface AlpacaOptionContract {
  id?: string;
  symbol: string;
  name?: string;
  status?: string;
  tradable?: boolean;
  expiration_date: string;
  root_symbol?: string;
  underlying_symbol: string;
  type: OptionType;
  style?: string;
  strike_price: string | number;
  size?: string | number;
  open_interest?: string | number | null;
  close_price?: string | number | null;
}

export interface OptionSnapshot {
  latestQuote?: {
    bp?: number;
    bid_price?: number;
    ap?: number;
    ask_price?: number;
  };
  latestTrade?: {
    p?: number;
    price?: number;
    s?: number;
    size?: number;
  };
  greeks?: {
    delta?: number;
    implied_volatility?: number;
    iv?: number;
  };
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
}

export interface OptionChainRow {
  symbol: string;
  underlyingSymbol: string;
  expirationDate: string;
  type: OptionType;
  strikePrice: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  volume: number | null;
  openInterest: number | null;
  tradable: boolean;
}

export interface OptionOrderLeg {
  id: string;
  symbol: string;
  side: OptionLegSide;
  ratioQuantity: number;
  type: OptionType;
  strikePrice: number;
  expirationDate: string;
  limitPrice: number | null;
  positionIntent: 'buy_to_open' | 'sell_to_open' | 'buy_to_close' | 'sell_to_close';
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveSnapshot(snapshots: Record<string, OptionSnapshot> | undefined, symbol: string) {
  return snapshots?.[symbol] || snapshots?.[symbol.toUpperCase()] || {};
}

function resolveBid(snapshot: OptionSnapshot) {
  return toNumber(snapshot.latestQuote?.bp ?? snapshot.latestQuote?.bid_price);
}

function resolveAsk(snapshot: OptionSnapshot) {
  return toNumber(snapshot.latestQuote?.ap ?? snapshot.latestQuote?.ask_price);
}

function resolveLast(snapshot: OptionSnapshot) {
  return toNumber(snapshot.latestTrade?.p ?? snapshot.latestTrade?.price);
}

function resolveMark(bid: number | null, ask: number | null, last: number | null) {
  if (bid != null && ask != null) return (bid + ask) / 2;
  return last;
}

export function normalizeOptionChainRows(
  contracts: AlpacaOptionContract[],
  snapshots: Record<string, OptionSnapshot> = {},
): OptionChainRow[] {
  return contracts
    .filter((contract) => contract.symbol && contract.expiration_date && contract.strike_price != null)
    .map((contract) => {
      const symbol = contract.symbol.toUpperCase();
      const snapshot = resolveSnapshot(snapshots, symbol);
      const bid = resolveBid(snapshot);
      const ask = resolveAsk(snapshot);
      const last = resolveLast(snapshot) ?? toNumber(contract.close_price);

      return {
        symbol,
        underlyingSymbol: String(contract.underlying_symbol || contract.root_symbol || '').toUpperCase(),
        expirationDate: contract.expiration_date,
        type: contract.type,
        strikePrice: toNumber(contract.strike_price) ?? 0,
        bid,
        ask,
        last,
        mark: resolveMark(bid, ask, last),
        impliedVolatility: toNumber(snapshot.greeks?.implied_volatility ?? snapshot.greeks?.iv ?? snapshot.impliedVolatility),
        delta: toNumber(snapshot.greeks?.delta),
        volume: toNumber(snapshot.volume ?? snapshot.latestTrade?.s ?? snapshot.latestTrade?.size),
        openInterest: toNumber(snapshot.openInterest ?? contract.open_interest),
        tradable: contract.tradable !== false && contract.status !== 'inactive',
      };
    })
    .sort((a, b) =>
      a.expirationDate.localeCompare(b.expirationDate) ||
      a.strikePrice - b.strikePrice ||
      a.type.localeCompare(b.type),
    );
}

export function getOptionExpirations(rows: OptionChainRow[]) {
  return Array.from(new Set(rows.map((row) => row.expirationDate))).sort();
}

export function filterOptionChainRows(input: {
  rows: OptionChainRow[];
  expirationDate?: string;
  type?: OptionType | 'all';
}) {
  return input.rows.filter((row) =>
    (!input.expirationDate || row.expirationDate === input.expirationDate) &&
    (!input.type || input.type === 'all' || row.type === input.type),
  );
}

export function findDefaultOptionContract(input: {
  rows: OptionChainRow[];
  expirationDate?: string;
  type?: OptionType;
  underlyingPrice?: number | null;
}) {
  const candidates = filterOptionChainRows({
    rows: input.rows,
    expirationDate: input.expirationDate,
    type: input.type || 'call',
  });

  if (candidates.length === 0) return null;

  const target = input.underlyingPrice ?? candidates[Math.floor(candidates.length / 2)].strikePrice;
  return [...candidates].sort((a, b) =>
    Math.abs(a.strikePrice - target) - Math.abs(b.strikePrice - target),
  )[0];
}

function legId(index: number) {
  return `leg-${index + 1}`;
}

function defaultPositionIntent(side: OptionLegSide) {
  return side === 'buy' ? 'buy_to_open' : 'sell_to_open';
}

export function buildOptionOrderLegs(input: {
  strategyType: OptionStrategyType;
  selected: OptionChainRow;
  rows: OptionChainRow[];
  quantity: number;
  side: OptionLegSide;
}): OptionOrderLeg[] {
  const baseLeg: OptionOrderLeg = {
    id: legId(0),
    symbol: input.selected.symbol,
    side: input.side,
    ratioQuantity: Math.max(1, Math.floor(input.quantity || 1)),
    type: input.selected.type,
    strikePrice: input.selected.strikePrice,
    expirationDate: input.selected.expirationDate,
    limitPrice: input.selected.mark,
    positionIntent: defaultPositionIntent(input.side),
  };

  if (input.strategyType === 'single') {
    return [baseLeg];
  }

  if (input.strategyType === 'straddle') {
    const companion = input.rows.find((row) =>
      row.expirationDate === input.selected.expirationDate &&
      row.strikePrice === input.selected.strikePrice &&
      row.type !== input.selected.type,
    );

    return companion
      ? [
          baseLeg,
          {
            ...baseLeg,
            id: legId(1),
            symbol: companion.symbol,
            type: companion.type,
            limitPrice: companion.mark,
          },
        ]
      : [baseLeg];
  }

  const sameSideChain = input.rows.filter((row) =>
    row.expirationDate === input.selected.expirationDate &&
    row.type === input.selected.type &&
    row.symbol !== input.selected.symbol,
  );
  const companion = sameSideChain
    .filter((row) => input.selected.type === 'call'
      ? row.strikePrice > input.selected.strikePrice
      : row.strikePrice < input.selected.strikePrice)
    .sort((a, b) => Math.abs(a.strikePrice - input.selected.strikePrice) - Math.abs(b.strikePrice - input.selected.strikePrice))[0];

  return companion
    ? [
        baseLeg,
        {
          id: legId(1),
          symbol: companion.symbol,
          side: input.side === 'buy' ? 'sell' : 'buy',
          ratioQuantity: baseLeg.ratioQuantity,
          type: companion.type,
          strikePrice: companion.strikePrice,
          expirationDate: companion.expirationDate,
          limitPrice: companion.mark,
          positionIntent: defaultPositionIntent(input.side === 'buy' ? 'sell' : 'buy'),
        },
      ]
    : [baseLeg];
}

export function estimateOptionOrderPremium(legs: OptionOrderLeg[]) {
  return legs.reduce((total, leg) => {
    const signed = leg.side === 'buy' ? 1 : -1;
    return total + signed * (leg.limitPrice ?? 0) * leg.ratioQuantity * 100;
  }, 0);
}

export function buildSampleOptionContracts(underlyingSymbol = 'TQQQ'): AlpacaOptionContract[] {
  const underlying = underlyingSymbol.toUpperCase();
  const expiration = '2026-07-17';
  return [68, 70, 72, 74].flatMap((strike) => [
    {
      symbol: `${underlying}260717C${String(strike * 1000).padStart(8, '0')}`,
      underlying_symbol: underlying,
      expiration_date: expiration,
      type: 'call' as OptionType,
      strike_price: String(strike),
      tradable: true,
      open_interest: String(500 + strike * 10),
      close_price: String(Math.max(0.25, 72 - strike + 2.1).toFixed(2)),
    },
    {
      symbol: `${underlying}260717P${String(strike * 1000).padStart(8, '0')}`,
      underlying_symbol: underlying,
      expiration_date: expiration,
      type: 'put' as OptionType,
      strike_price: String(strike),
      tradable: true,
      open_interest: String(400 + strike * 8),
      close_price: String(Math.max(0.25, strike - 70 + 1.3).toFixed(2)),
    },
  ]);
}

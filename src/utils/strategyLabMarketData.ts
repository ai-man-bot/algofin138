import {
  normalizeStrategyLabBar,
  normalizeStrategyLabQuote,
  normalizeStrategyLabSymbol,
  type StrategyLabBar,
  type StrategyLabBarTimeframe,
  type StrategyLabQuote,
} from './strategyLabModels.ts';

export interface AlpacaMarketDataCredentials {
  key: string;
  secret: string;
}

export interface FetchAlpacaMarketDataOptions {
  symbol: string;
  credentials: AlpacaMarketDataCredentials;
  feed?: string;
  fetchImpl?: typeof fetch;
}

const DATA_BASE_URL = 'https://data.alpaca.markets';

function assertCredentials(credentials: AlpacaMarketDataCredentials) {
  if (!credentials?.key || !credentials?.secret) {
    throw new Error('Missing Alpaca market data credentials');
  }
}

function alpacaHeaders(credentials: AlpacaMarketDataCredentials) {
  assertCredentials(credentials);
  return {
    'APCA-API-KEY-ID': credentials.key,
    'APCA-API-SECRET-KEY': credentials.secret,
  };
}

async function fetchJson(url: string, credentials: AlpacaMarketDataCredentials, fetchImpl: typeof fetch) {
  const response = await fetchImpl(url, {
    headers: alpacaHeaders(credentials),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Alpaca market data request failed with ${response.status}`);
  }

  return data;
}

export function normalizeAlpacaQuote(symbol: string, payload: any): StrategyLabQuote {
  const normalizedSymbol = normalizeStrategyLabSymbol(symbol);
  const price = payload?.trade?.p ?? payload?.latestTrade?.p ?? payload?.dailyBar?.c ?? payload?.quote?.ap ?? payload?.quote?.bp;
  const previousClose = payload?.previousDailyBar?.c ?? payload?.prevDailyBar?.c ?? payload?.dailyBar?.o ?? price;

  return normalizeStrategyLabQuote({
    symbol: normalizedSymbol,
    price,
    previousClose,
    currency: 'USD',
    source: 'alpaca',
    timestamp: payload?.trade?.t ?? payload?.latestTrade?.t ?? payload?.quote?.t ?? new Date().toISOString(),
    bid: payload?.quote?.bp,
    ask: payload?.quote?.ap,
  });
}

export function normalizeAlpacaBars(payload: any): StrategyLabBar[] {
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  return bars.map((bar: any) => normalizeStrategyLabBar(bar));
}

export async function fetchAlpacaQuote(options: FetchAlpacaMarketDataOptions): Promise<StrategyLabQuote> {
  const symbol = normalizeStrategyLabSymbol(options.symbol);
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const feed = options.feed || 'iex';
  const url = `${DATA_BASE_URL}/v2/stocks/${encodeURIComponent(symbol)}/snapshot?feed=${encodeURIComponent(feed)}`;
  const payload = await fetchJson(url, options.credentials, fetchImpl);
  return normalizeAlpacaQuote(symbol, payload);
}

export async function fetchAlpacaBars(options: FetchAlpacaMarketDataOptions & {
  timeframe: StrategyLabBarTimeframe;
  start?: string;
  end?: string;
  limit?: number;
}): Promise<StrategyLabBar[]> {
  const symbol = normalizeStrategyLabSymbol(options.symbol);
  if (!symbol) {
    throw new Error('Symbol is required');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const params = new URLSearchParams({
    symbols: symbol,
    timeframe: options.timeframe,
    feed: options.feed || 'iex',
    limit: String(options.limit || 1000),
  });
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);

  const payload = await fetchJson(`${DATA_BASE_URL}/v2/stocks/bars?${params.toString()}`, options.credentials, fetchImpl);
  const barsPayload = Array.isArray(payload?.bars?.[symbol]) ? { bars: payload.bars[symbol] } : payload;
  return normalizeAlpacaBars(barsPayload);
}

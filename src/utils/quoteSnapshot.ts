/**
 * Normalizes Alpaca v2 stock snapshots into the quote shape the frontend
 * consumes: ask/bid (`ap`/`bp`) for position quote consumers plus price and
 * previous-close data so watchlists can display live change percentages.
 */

export interface QuoteSnapshot {
  symbol: string;
  price: number | null;
  ap: number | null;
  bp: number | null;
  previousClose: number | null;
  change: number;
  changePct: number;
  asOf: string | null;
}

export function normalizeQuoteSnapshot(symbol: string, snapshot: any): QuoteSnapshot {
  const price = Number(snapshot?.latestTrade?.p ?? snapshot?.latestQuote?.ap ?? snapshot?.latestQuote?.bp ?? snapshot?.dailyBar?.c);
  const previousClose = Number(snapshot?.prevDailyBar?.c ?? snapshot?.dailyBar?.o);
  const hasPrice = Number.isFinite(price);
  const hasPreviousClose = Number.isFinite(previousClose) && previousClose !== 0;
  const change = hasPrice && hasPreviousClose ? price - previousClose : 0;
  const changePct = hasPreviousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol: String(symbol || '').trim().toUpperCase(),
    price: hasPrice ? price : null,
    ap: snapshot?.latestQuote?.ap ?? null,
    bp: snapshot?.latestQuote?.bp ?? null,
    previousClose: hasPreviousClose ? previousClose : null,
    change,
    changePct,
    asOf: snapshot?.latestTrade?.t ?? snapshot?.latestQuote?.t ?? null,
  };
}

/** Builds the `{ quotes: { SYMBOL: quote } }` payload returned by POST /alpaca/quotes. */
export function buildAlpacaQuotesResponse(snapshots: any): { quotes: Record<string, QuoteSnapshot> } {
  const quotes: Record<string, QuoteSnapshot> = {};

  for (const [symbol, snapshot] of Object.entries(snapshots ?? {})) {
    if (snapshot === null || typeof snapshot !== 'object') continue;
    const normalized = normalizeQuoteSnapshot(symbol, snapshot);
    quotes[normalized.symbol] = normalized;
  }

  return { quotes };
}

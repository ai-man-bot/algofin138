/**
 * Trade Assistant Parser
 * Supports:
 * - Equity commands: "Buy 1 TQQQ", "MSFT: BTOBuy To Open at 402.26 with first target above 410.31"
 * - Option alerts: "GOOGL 392.5C 5/8: BTOBuy To Open at 2.25 with first target above 2.59"
 * - Option exits: "GOOGL 392.5C 05/08 : STCReached Target 3.10 ... Raise the stops to 2.25"
 *
 * Alpaca option symbols use OCC-style format:
 *   UNDERLYING + YYMMDD + C/P + 8-digit strike x 1000
 *   Example: GOOGL 392.5C 05/08/2026 => GOOGL260508C00392500
 */

export type ParsedTradeIntent = {
  intent: 'place_order' | 'close_or_reduce_position';
  asset_class: 'equity' | 'option' | 'crypto';
  source_type: 'plain_english' | 'signal_alert';
  raw_input: string;

  symbol: string;
  underlying_symbol?: string;
  option_symbol?: string;
  option_type?: 'call' | 'put';
  expiration_date?: string;
  strike_price?: number;

  side: 'buy' | 'sell';
  position_intent?: 'buy_to_open' | 'sell_to_close';
  qty: number | null;
  requires_quantity: boolean;

  order_type: 'market' | 'limit';
  limit_price?: number | null;
  time_in_force: 'day' | 'gtc' | 'ioc';

  entry_price?: number | null;
  target_price?: number | null;
  stop_price?: number | null;
  target_percent?: number | null;

  confidence: number;
  warnings: string[];
  requires_confirmation: true;
};

const EQUITY_ETF_SYMBOLS_THAT_END_WITH_USD = new Set(['SPY', 'QQQ', 'TQQQ', 'SQQQ']);

function cleanInput(input: string) {
  return input
    .replace(/\s+/g, ' ')
    .replace(/\s+:/g, ':')
    .trim();
}

function currentYearForExpiration(month: number, day: number) {
  const now = new Date();
  let year = now.getFullYear();

  const candidate = new Date(year, month - 1, day, 23, 59, 59);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  // If the date is clearly stale, roll to next year.
  if (candidate < thirtyDaysAgo) {
    year += 1;
  }

  return year;
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildOccOptionSymbol(
  underlying: string,
  expirationIso: string,
  optionType: 'call' | 'put',
  strike: number,
) {
  const [year, month, day] = expirationIso.split('-');
  const yy = year.slice(2);
  const cp = optionType === 'call' ? 'C' : 'P';
  const strikePart = String(Math.round(strike * 1000)).padStart(8, '0');

  return `${underlying.toUpperCase()}${yy}${month}${day}${cp}${strikePart}`;
}

function parseExpiration(monthText: string, dayText: string, yearText?: string) {
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  let year = yearText ? Number(yearText) : currentYearForExpiration(month, day);

  if (year < 100) year += 2000;

  return toIsoDate(year, month, day);
}

function parseNumber(value?: string | null) {
  if (!value) return null;
  const n = Number(value.replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function inferCrypto(symbol: string) {
  const upper = symbol.toUpperCase();
  return upper.endsWith('USD') && !EQUITY_ETF_SYMBOLS_THAT_END_WITH_USD.has(upper);
}

function parseOptionAlert(input: string): ParsedTradeIntent | null {
  const text = cleanInput(input);

  // Example:
  // GOOGL 392.5C 5/8: BTOBuy To Open at 2.25 with first target above 2.59
  // MSFT 450C 06/18 : STCReached Target 4.40 ... Raise the stops to 3.08
  const optionPattern =
    /^([A-Z]{1,6})\s+(\d+(?:\.\d+)?)([CP])\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*:?\s*(BTO|STC)\s*(.*)$/i;

  const match = text.match(optionPattern);
  if (!match) return null;

  const [, underlyingRaw, strikeRaw, cpRaw, monthRaw, dayRaw, yearRaw, codeRaw, restRaw] = match;

  const underlying = underlyingRaw.toUpperCase();
  const strike = Number(strikeRaw);
  const optionType = cpRaw.toUpperCase() === 'C' ? 'call' : 'put';
  const expirationDate = parseExpiration(monthRaw, dayRaw, yearRaw);

  if (!expirationDate || !Number.isFinite(strike)) return null;

  const positionIntent = codeRaw.toUpperCase() === 'BTO' ? 'buy_to_open' : 'sell_to_close';
  const side = positionIntent === 'buy_to_open' ? 'buy' : 'sell';
  const intent = positionIntent === 'buy_to_open' ? 'place_order' : 'close_or_reduce_position';
  const optionSymbol = buildOccOptionSymbol(underlying, expirationDate, optionType, strike);

  const entryPrice =
    parseNumber(restRaw.match(/(?:open|at)\s+\$?(\d+(?:\.\d+)?)/i)?.[1]) ??
    parseNumber(restRaw.match(/BTO.*?\$?(\d+(?:\.\d+)?)/i)?.[1]);

  const targetPrice =
    parseNumber(restRaw.match(/target(?:\s+above|\s+at|\s+)?\s+\$?(\d+(?:\.\d+)?)/i)?.[1]) ??
    parseNumber(restRaw.match(/reached target\s+\$?(\d+(?:\.\d+)?)/i)?.[1]);

  const stopPrice = parseNumber(restRaw.match(/stops?\s+to\s+\$?(\d+(?:\.\d+)?)/i)?.[1]);

  const targetPercent = parseNumber(restRaw.match(/that'?s\s+(\d+(?:\.\d+)?)%/i)?.[1]);

  const warnings: string[] = [];

  let qty: number | null = 1;
  let requiresQuantity = false;

  if (positionIntent === 'sell_to_close') {
    // STC alerts often say "lock some in" without quantity. Require confirmation.
    qty = null;
    requiresQuantity = true;
    warnings.push('STC signal does not specify quantity. Select how many contracts to close before submitting.');
  }

  if (positionIntent === 'buy_to_open' && entryPrice == null) {
    warnings.push('No entry price found. Defaulting to market order unless changed before confirmation.');
  }

  return {
    intent,
    asset_class: 'option',
    source_type: 'signal_alert',
    raw_input: input,

    symbol: optionSymbol,
    underlying_symbol: underlying,
    option_symbol: optionSymbol,
    option_type: optionType,
    expiration_date: expirationDate,
    strike_price: strike,

    side,
    position_intent: positionIntent,
    qty,
    requires_quantity: requiresQuantity,

    order_type: entryPrice != null && positionIntent === 'buy_to_open' ? 'limit' : 'market',
    limit_price: entryPrice != null && positionIntent === 'buy_to_open' ? entryPrice : null,
    time_in_force: 'day',

    entry_price: entryPrice,
    target_price: targetPrice,
    stop_price: stopPrice,
    target_percent: targetPercent,

    confidence: 0.93,
    warnings,
    requires_confirmation: true,
  };
}

function parseEquitySignal(input: string): ParsedTradeIntent | null {
  const text = cleanInput(input);

  // Example:
  // MSFT: BTOBuy To Open at 402.26 with first target above 410.31
  const pattern = /^([A-Z]{1,8})\s*:?\s*(BTO|STC)\s*(.*)$/i;
  const match = text.match(pattern);
  if (!match) return null;

  const [, symbolRaw, codeRaw, restRaw] = match;
  const symbol = symbolRaw.toUpperCase();
  const positionIntent = codeRaw.toUpperCase() === 'BTO' ? 'buy_to_open' : 'sell_to_close';
  const side = positionIntent === 'buy_to_open' ? 'buy' : 'sell';
  const intent = positionIntent === 'buy_to_open' ? 'place_order' : 'close_or_reduce_position';

  const entryPrice =
    parseNumber(restRaw.match(/(?:open|at)\s+\$?(\d+(?:\.\d+)?)/i)?.[1]) ??
    parseNumber(restRaw.match(/BTO.*?\$?(\d+(?:\.\d+)?)/i)?.[1]);

  const targetPrice =
    parseNumber(restRaw.match(/target(?:\s+above|\s+at|\s+)?\s+\$?(\d+(?:\.\d+)?)/i)?.[1]) ??
    parseNumber(restRaw.match(/reached target\s+\$?(\d+(?:\.\d+)?)/i)?.[1]);

  const stopPrice = parseNumber(restRaw.match(/stops?\s+to\s+\$?(\d+(?:\.\d+)?)/i)?.[1]);
  const targetPercent = parseNumber(restRaw.match(/that'?s\s+(\d+(?:\.\d+)?)%/i)?.[1]);

  const warnings: string[] = [];
  let qty: number | null = 1;
  let requiresQuantity = false;

  if (positionIntent === 'sell_to_close') {
    qty = null;
    requiresQuantity = true;
    warnings.push('STC signal does not specify quantity. Select shares/contracts to close before submitting.');
  }

  return {
    intent,
    asset_class: inferCrypto(symbol) ? 'crypto' : 'equity',
    source_type: 'signal_alert',
    raw_input: input,

    symbol,
    side,
    position_intent: positionIntent,
    qty,
    requires_quantity: requiresQuantity,

    order_type: entryPrice != null && positionIntent === 'buy_to_open' ? 'limit' : 'market',
    limit_price: entryPrice != null && positionIntent === 'buy_to_open' ? entryPrice : null,
    time_in_force: inferCrypto(symbol) ? 'gtc' : 'day',

    entry_price: entryPrice,
    target_price: targetPrice,
    stop_price: stopPrice,
    target_percent: targetPercent,

    confidence: 0.88,
    warnings,
    requires_confirmation: true,
  };
}

function parsePlainEnglish(input: string): ParsedTradeIntent | null {
  const text = cleanInput(input);

  // Examples:
  // Buy 1 TQQQ
  // Sell 2 SOLUSD
  // Buy $500 NVDA
  const pattern = /^(buy|sell)\s+(?:(\d+(?:\.\d+)?)\s+shares?\s+of\s+|(\d+(?:\.\d+)?)\s+|\$(\d+(?:\.\d+)?)\s+worth\s+of\s+)?([A-Z]{1,10}(?:USD)?)\b/i;
  const match = text.match(pattern);
  if (!match) return null;

  const [, sideRaw, sharesA, sharesB, notionalRaw, symbolRaw] = match;
  const side = sideRaw.toLowerCase() as 'buy' | 'sell';
  const symbol = symbolRaw.toUpperCase();
  const qty = parseNumber(sharesA || sharesB) ?? null;
  const notional = parseNumber(notionalRaw);

  const warnings: string[] = [];

  if (!qty && !notional) {
    warnings.push('No quantity or notional amount found. Quantity is required before confirmation.');
  }

  return {
    intent: 'place_order',
    asset_class: inferCrypto(symbol) ? 'crypto' : 'equity',
    source_type: 'plain_english',
    raw_input: input,

    symbol,
    side,
    qty,
    requires_quantity: !qty && !notional,

    order_type: 'market',
    limit_price: null,
    time_in_force: inferCrypto(symbol) ? 'gtc' : 'day',

    confidence: 0.75,
    warnings,
    requires_confirmation: true,
  };
}

export function parseTradeAssistantInput(input: string): ParsedTradeIntent {
  const parsed =
    parseOptionAlert(input) ??
    parseEquitySignal(input) ??
    parsePlainEnglish(input);

  if (!parsed) {
    throw new Error(
      'Could not parse trade instruction. Try formats like "Buy 1 TQQQ", "GOOGL 392.5C 5/8: BTOBuy To Open at 2.25", or "MSFT: BTOBuy To Open at 402.26".',
    );
  }

  return parsed;
}

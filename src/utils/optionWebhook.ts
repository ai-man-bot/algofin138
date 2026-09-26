export function marketDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function decodeWebhookBody(body: string, contentType = ''): Record<string, any> {
  if (!body.trim() || body.length > 16_384) throw new Error('Webhook body is empty or too large');
  let value: unknown;
  try { value = JSON.parse(body); } catch {
    if (contentType.toLowerCase().includes('json') || /^[\s]*[\[{]/.test(body)) {
      throw new Error('Invalid JSON body');
    }
    value = body;
  }
  if (typeof value === 'string') return { message: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object or option message');
  return value as Record<string, any>;
}

export function parseOptionMessage(message: unknown, now = new Date()) {
  if (typeof message !== 'string') throw new Error('Option message must be text');
  const match = message.trim().match(/^([a-z]{1,6})\s*:?\s+(\d+(?:\.\d{1,3})?)\s*([cp])\s+(\d{1,2})\/(\d{1,2})\s*:\s*BTO(?:\s+Buy\s+to\s+open)?\s+at\s+\$?(\d+(?:\.\d{1,2})?)\s+with\s+first\s+target\s+(?:above\s+|at\s+)?\$?(\d+(?:\.\d{1,2})?)\s*\.?$/i);
  if (!match) throw new Error('Expected SYMBOL: STRIKE[C/P] M/D: BTO Buy to open at PRICE with first target above PRICE');
  const [, root, strikeText, cp, monthText, dayText, entry, target] = match;
  const month = Number(monthText), day = Number(dayText), strike = Number(strikeText);
  if (![strike, Number(entry), Number(target)].every(Number.isFinite) || strike <= 0 || strike >= 100000 || Number(entry) <= 0 || Number(target) <= Number(entry)) {
    throw new Error('Strike and entry must be positive; first target must exceed entry');
  }
  const today = marketDate(now);
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const year = Number(today.slice(0, 4)) + (md < today.slice(5) ? 1 : 0);
  const expiration = `${year}-${md}`;
  const date = new Date(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiration) throw new Error('Invalid expiration date');
  const underlying = root.toUpperCase();
  const symbol = `${underlying}${String(year).slice(-2)}${md.replace('-', '')}${cp.toUpperCase()}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
  return { underlying, symbol, expiration, strike, option_type: cp.toUpperCase() === 'C' ? 'call' : 'put',
    entry_price: Number(entry).toFixed(2), target_price: Number(target).toFixed(2), quantity: 3, target_quantity: 1 };
}

export function isOptionMessagePayload(payload: Record<string, any>) {
  if (payload.message === undefined) return false;
  // Structured orders may already carry a free-form informational message.
  // Route option-looking instructions here so conflicting order fields are rejected.
  return payload.symbol === undefined || typeof payload.message !== 'string' ||
    /^\s*[a-z]{1,6}\s*:?\s+\d+(?:\.\d+)?\s*[cp]\b/i.test(payload.message) ||
    /\b(?:BTO|buy\s+to\s+open)\b/i.test(payload.message);
}

export function assertOptionContract(contract: any, plan: ReturnType<typeof parseOptionMessage>) {
  if (contract?.symbol !== plan.symbol || contract?.underlying_symbol !== plan.underlying ||
      contract?.expiration_date !== plan.expiration || contract?.type !== plan.option_type ||
      Number(contract?.strike_price) !== Number(plan.strike) || contract?.status !== 'active' || contract?.tradable !== true) {
    throw new Error('Matching active tradable option contract was not found');
  }
}

export function optionOrder(plan: any, leg: 'entry' | 'target') {
  return {
    symbol: plan.symbol, qty: leg === 'entry' ? '3' : '1',
    side: leg === 'entry' ? 'buy' : 'sell', position_intent: leg === 'entry' ? 'buy_to_open' : 'sell_to_close',
    type: 'limit', limit_price: Number(leg === 'entry' ? plan.entry_price : plan.target_price).toFixed(2),
    time_in_force: leg === 'entry' ? 'day' : plan.target_time_in_force,
    client_order_id: `opt-${plan.id}-${leg === 'entry' ? 'e' : 't'}`,
  };
}

export async function optionDeliveryKey(scope: string, plan: any, eventId: unknown, now = new Date()) {
  if (eventId !== undefined && (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200)) {
    throw new Error('event_id must be a nonempty string of at most 200 characters');
  }
  // Without a provider ID, identical normalized signals on the same NY date are one delivery.
  const identity = eventId === undefined ? [marketDate(now), plan.symbol, plan.entry_price, plan.target_price] : ['event', eventId];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([scope, identity])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

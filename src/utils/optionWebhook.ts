import { parseWebhookSignal } from './webhookSignal.ts';
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

export const DEFAULT_OPTION_ENTRY_QUANTITY = 3;
export const DEFAULT_OPTION_TARGET_QUANTITY = 1;

export function normalizeOptionEntryQuantity(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_OPTION_ENTRY_QUANTITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('quantity must be a whole number between 1 and 1000');
  }
  return parsed;
}

export function normalizeOptionTargetQuantity(value: unknown, entryQuantity: number): number {
  if (value === undefined || value === null || value === '') return DEFAULT_OPTION_TARGET_QUANTITY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > entryQuantity) {
    throw new Error('target_quantity must be a whole number between 1 and the entry quantity');
  }
  return parsed;
}

export function parseOptionMessage(message: unknown, now = new Date(), sizing?: { quantity?: unknown; targetQuantity?: unknown }) {
  const signal = parseWebhookSignal(message);
  if (signal.asset !== 'option' || signal.action !== 'open') throw new Error('Expected an option BTO entry; use webhook Preview for other actions');
  const quantity = normalizeOptionEntryQuantity(sizing?.quantity);
  const targetQuantity = normalizeOptionTargetQuantity(sizing?.targetQuantity, quantity);
  const today = marketDate(now);
  const md = `${String(signal.month).padStart(2, '0')}-${String(signal.day).padStart(2, '0')}`;
  const year = signal.year ?? (Number(today.slice(0, 4)) + (md < today.slice(5) ? 1 : 0));
  const expiration = `${year}-${md}`;
  const date = new Date(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiration || expiration < today) throw new Error('Invalid expiration date or expiration has passed');
  const symbol = `${signal.underlying}${String(year).slice(-2)}${md.replace('-', '')}${signal.option_type === 'call' ? 'C' : 'P'}${String(Math.round(signal.strike! * 1000)).padStart(8, '0')}`;
  return { underlying: signal.underlying, symbol, expiration, strike: signal.strike!, option_type: signal.option_type!,
    entry_price: signal.reference_price!, target_price: signal.target_price!, quantity, target_quantity: targetQuantity };
}
export function isOptionMessagePayload(payload: Record<string, any>) {
  if (payload.message === undefined) return false;
  // Structured orders may already carry a free-form informational message.
  // Route option-looking instructions here so conflicting order fields are rejected.
  return payload.symbol === undefined || typeof payload.message !== 'string' ||
    /^\s*[a-z]{1,6}\s*:?\s+\d+(?:\.\d+)?\s*[cp]\b/i.test(payload.message) ||
    /\b(?:BTO(?:Buy)?|STC(?:Close|Reached)?|DCA(?:Add)?|buy\s+to\s+open)\b/i.test(payload.message);
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
    symbol: plan.symbol,
    qty: String(leg === 'entry'
      ? Number(plan.quantity ?? DEFAULT_OPTION_ENTRY_QUANTITY)
      : Number(plan.target_quantity ?? DEFAULT_OPTION_TARGET_QUANTITY)),
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
  // Non-default quantities join the identity so differently sized tickets are distinct plans;
  // default-sized deliveries keep the historical key so in-flight dedupe is unchanged.
  const quantity = Number(plan.quantity ?? DEFAULT_OPTION_ENTRY_QUANTITY);
  const targetQuantity = Number(plan.target_quantity ?? DEFAULT_OPTION_TARGET_QUANTITY);
  const identity = eventId === undefined ? [
    marketDate(now), plan.symbol, plan.entry_price, plan.target_price,
    quantity !== DEFAULT_OPTION_ENTRY_QUANTITY ? quantity : undefined,
    targetQuantity !== DEFAULT_OPTION_TARGET_QUANTITY ? targetQuantity : undefined,
  ] : ['event', eventId];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([scope, identity])));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

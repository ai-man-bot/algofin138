import { marketDate, parseOptionMessage } from './optionWebhook.ts';

export type OptionInstruction = ReturnType<typeof parseOptionMessage>;
export type OptionTicketInput = { message: string } | { symbol: string; entry_price: string; target_price: string };
export type OptionPlan = OptionInstruction & {
  id: string; broker_account_id: string; broker_base_url: string; status: string;
  entry_status: string | null; target_status: string | null; entry_order_id: string | null;
  target_order_id: string | null; entry_filled_qty: number; target_filled_qty: number;
  last_error: string | null; created_at: string;
  management?: { exit_filled_qty?: number; stop_price?: number | null; enabled?: boolean };
};

export function normalizeOptionTicket(input: Record<string, unknown>, now = new Date()): OptionInstruction {
  const unsupported = ['qty', 'quantity', 'side', 'action', 'type', 'order_type', 'time_in_force', 'target_quantity', 'position_intent'];
  if (unsupported.some(key => input[key] !== undefined)) throw new Error('The ticket uses 3 BTO contracts and one GTC target; custom order instructions are not supported');
  if (input.message !== undefined) {
    if (['symbol', 'entry_price', 'target_price'].some(key => input[key] !== undefined)) throw new Error('Use either a message or contract fields');
    return parseOptionMessage(input.message, now);
  }
  const symbol = String(input.symbol ?? '').trim().toUpperCase();
  const match = symbol.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!match) throw new Error('Select a valid option contract');
  const [, underlying, yy, mm, dd, cp, strikeText] = match;
  const expiration = `20${yy}-${mm}-${dd}`;
  const date = new Date(`${expiration}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiration || expiration < marketDate(now)) {
    throw new Error('Contract expiration is invalid or has passed');
  }
  const price = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) throw new Error('Enter a positive price with at most two decimal places');
    return Number(text).toFixed(2);
  };
  const entry_price = price(input.entry_price), target_price = price(input.target_price);
  if (Number(target_price) <= Number(entry_price)) throw new Error('First target must exceed entry price');
  const strike = Number(strikeText) / 1000;
  if (strike <= 0) throw new Error('Invalid strike');
  return { symbol, underlying, expiration, option_type: cp === 'C' ? 'call' : 'put', strike,
    entry_price, target_price, quantity: 3, target_quantity: 1 };
}

export function optionPlanLabel(plan: Pick<OptionPlan, 'status' | 'entry_status' | 'target_status'>) {
  if (plan.status === 'needs_attention') return 'Needs attention';
  if (plan.status === 'entry_terminal') return `Entry ${plan.entry_status || 'not placed'}`;
  if (plan.status === 'first_target_filled') return 'First target filled';
  if (plan.status === 'closed') return 'Closed';
  if (plan.status === 'protected') return 'Remaining contracts protected by broker stop';
  if (plan.status === 'managed') return 'Managed — no active protective stop';
  if (plan.status === 'management_pending') return 'Exit or stop update pending';
  if (plan.target_status) return `Target ${plan.target_status.replace(/_/g, ' ')}`;
  if (plan.entry_status) return `Entry ${plan.entry_status.replace(/_/g, ' ')}`;
  return plan.status === 'queued' ? 'Plan queued — not yet accepted by Alpaca' : plan.status.replace(/_/g, ' ');
}

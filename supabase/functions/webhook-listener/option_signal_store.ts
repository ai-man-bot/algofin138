import type { WebhookSignal } from '../../../src/utils/webhookSignal.ts';
import { marketDate } from '../../../src/utils/optionWebhook.ts';
import { OptionPlanConflict } from './option_plan_store.ts';

export function matchOptionSignalPlan(plans: any[], instruction: WebhookSignal, now = new Date()) {
  const matching = plans.filter(plan => plan.underlying === instruction.underlying &&
    Number(plan.strike) === instruction.strike && plan.option_type === instruction.option_type &&
    Number(plan.expiration?.slice(5,7)) === instruction.month && Number(plan.expiration?.slice(8,10)) === instruction.day &&
    (!instruction.year || Number(plan.expiration?.slice(0,4)) === instruction.year) && plan.expiration >= marketDate(now));
  const live = matching.filter(plan => plan.status !== 'closed' && !(plan.status === 'entry_terminal' && !Number(plan.entry_filled_qty)));
  const candidates = live.length ? live : matching;
  if (candidates.length !== 1) throw new OptionPlanConflict(candidates.length ? 'Ambiguous trade: more than one matching managed plan' : 'No matching unexpired managed trade');
  return candidates[0];
}

export async function resolveOptionSignalPlan(db: any, userId: string, brokerId: string, scope: string, instruction: WebhookSignal) {
  const { data, error } = await db.from('option_trade_plans').select('*')
    .eq('user_id', userId).eq('broker_account_id', brokerId).eq('route_scope', scope).eq('underlying', instruction.underlying).limit(201);
  if (error) throw new Error(error.message);
  if (data?.length > 200) throw new OptionPlanConflict('Too many candidate trades; use an explicit expiration year');
  return matchOptionSignalPlan(data || [], instruction);
}

export async function storeOptionSignal(db: any, input: {
  userId: string; brokerId: string; baseUrl: string; scope: string; instruction: WebhookSignal; message: string; eventId?: unknown;
}) {
  if (input.eventId !== undefined && (typeof input.eventId !== 'string' || !input.eventId.trim() || input.eventId.length > 200)) throw new Error('event_id must be a nonempty string of at most 200 characters');
  const plan = await resolveOptionSignalPlan(db,input.userId,input.brokerId,input.scope,input.instruction);
  if (plan.broker_base_url !== input.baseUrl) throw new OptionPlanConflict('Broker environment changed; restore the original connection');
  const instruction={...input.instruction,year:Number(plan.expiration.slice(0,4))};
  const identity = input.eventId === undefined ? ['action',plan.id,input.instruction.action,input.instruction.reference_price,
    input.instruction.stop_price,input.instruction.target_number] : ['event',input.eventId];
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([input.scope,identity])));
  const key = Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  const { data, error } = await db.rpc('enqueue_option_signal_action', {
    p_plan_id:plan.id,p_user_id:input.userId,p_scope:input.scope,p_key:key,p_instruction:instruction,p_message:input.message,
  });
  if (error) {
    if (/event_id|matching|expired|Unsupported/.test(error.message)) throw new OptionPlanConflict(error.message);
    throw new Error(error.message);
  }
  return { plan, action:data.action, duplicate:data.duplicate };
}

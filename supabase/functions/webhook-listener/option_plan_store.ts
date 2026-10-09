import { optionDeliveryKey } from '../../../src/utils/optionWebhook.ts';

export class OptionPlanConflict extends Error {}
export async function storeOptionPlan(supabase: any, input: {
  parsed: any; userId: string; brokerId: string; baseUrl: string; scope: string;
  strategyId?: string | null; message: string; eventId?: unknown;
}) {
  const deliveryKey = await optionDeliveryKey(input.scope, input.parsed, input.eventId);
  const row = { ...input.parsed, user_id: input.userId, broker_account_id: input.brokerId,
    broker_base_url: input.baseUrl, route_scope: input.scope, strategy_id: input.strategyId ?? null,
    delivery_key: deliveryKey, original_message: input.message, target_time_in_force: 'gtc' };
  const inserted = await supabase.from('option_trade_plans').insert(row).select('*').single();
  if (!inserted.error) return { plan: inserted.data, duplicate: false };
  if (inserted.error.code !== '23505') {
    if (/event_id was already used/.test(inserted.error.message)) throw new OptionPlanConflict(inserted.error.message);
    throw new Error(inserted.error.message);
  }
  const existing = await supabase.from('option_trade_plans').select('*').eq('delivery_key', deliveryKey).eq('user_id', input.userId).single();
  if (existing.error) throw new Error(existing.error.message);
  const plan = existing.data;
  if (plan.symbol !== row.symbol || Number(plan.entry_price) !== Number(row.entry_price) ||
      Number(plan.target_price) !== Number(row.target_price) || plan.broker_account_id !== row.broker_account_id) {
    throw new OptionPlanConflict('This request ID was already used for different instructions');
  }
  return { plan, duplicate: true };
}

import { assertOptionContract, marketDate, optionOrder } from '../../../src/utils/optionWebhook.ts';

export class OptionBrokerError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function optionBrokerClient(baseUrl: string, headers: Record<string, string>, fetcher = fetch) {
  return async (path: string, body?: any) => {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: body ? 'POST' : 'GET', headers: { ...headers, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new OptionBrokerError(data?.message || `Alpaca HTTP ${response.status}`, response.status);
    if (!data) throw new Error('Empty Alpaca response; reconciliation required');
    return data;
  };
}

type Dependencies = {
  broker: (path: string, body?: any) => Promise<any>;
  save: (patch: Record<string, any>) => Promise<void>;
  allowEntry: () => Promise<void>;
  now?: () => Date;
};
const terminal = new Set(['canceled', 'expired', 'rejected', 'replaced']);

// Every submission intent is committed before POST. Following an ambiguous response,
// only look up the same client ID: never blindly repeat an order POST.
export async function reconcileOptionPlan(plan: any, deps: Dependencies) {
  const now = deps.now ?? (() => new Date());
  const save = async (patch: Record<string, any>) => { await deps.save(patch); Object.assign(plan, patch); };
  async function ensureOrder(leg: 'entry' | 'target') {
    const payload = optionOrder(plan, leg);
    try {
      const existing = await deps.broker(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(payload.client_order_id)}`);
      if (existing.client_order_id !== payload.client_order_id || existing.symbol !== plan.symbol ||
          existing.side !== payload.side || Number(existing.qty) !== Number(payload.qty) ||
          existing.type !== 'limit' || Number(existing.limit_price) !== Number(payload.limit_price)) {
        await save({ status: 'needs_attention', last_error: 'Broker order does not match stored trade plan' });
        return null;
      }
      return existing;
    } catch (error) {
      if (!(error instanceof OptionBrokerError) || error.status !== 404) throw error;
    }
    const attempted = plan[`${leg}_attempted_at`];
    if (attempted) {
      if (now().getTime() - new Date(attempted).getTime() > 300_000) {
        await save({ status: 'needs_attention', last_error: `${leg} submission outcome unknown; inspect Alpaca before any manual retry. ${plan.last_error || ''}` });
      }
      return null;
    }
    if (leg === 'entry') {
      if (plan.expiration < marketDate(now())) {
        await save({ status: 'entry_terminal', last_error: 'Contract expired before entry submission' });
        return null;
      }
      await deps.allowEntry();
      try {
        assertOptionContract(await deps.broker(`/v2/options/contracts/${encodeURIComponent(plan.symbol)}`), plan);
      } catch (error) {
        if ((error instanceof OptionBrokerError && error.status === 404) || (error instanceof Error && error.message.includes('tradable option'))) {
          await save({ status: 'entry_terminal', last_error: error.message });
          return null;
        }
        throw error;
      }
    } else {
      if (plan.expiration < marketDate(now())) {
        await save({ status: 'needs_attention', last_error: 'Contract expired before first-target submission' });
        return null;
      }
      const position = await deps.broker(`/v2/positions/${encodeURIComponent(plan.symbol)}`);
      if (Number(position.qty_available ?? position.qty) < 1 || Number(position.qty) < 1) {
        await save({ status: 'needs_attention', last_error: 'No available long contract for first target' });
        return null;
      }
    }
    await save({ [`${leg}_attempted_at`]: now().toISOString(), status: `${leg}_submitting` });
    try { return await deps.broker('/v2/orders', payload); } catch (error) {
      // A duplicate-ID rejection might follow an accepted request; reconcile it first.
      await save({ last_error: `${leg}: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
  }
  const entry = await ensureOrder('entry');
  if (!entry) return;
  await save({ entry_order_id: entry.id, entry_status: entry.status, entry_filled_qty: Number(entry.filled_qty || 0),
    status: 'entry_pending', last_error: null });
  if (Number(entry.filled_qty || 0) < 1) {
    if (terminal.has(entry.status)) await save({ status: 'entry_terminal' });
    return;
  }
  const target = await ensureOrder('target');
  if (!target) return;
  await save({ target_order_id: target.id, target_status: target.status, target_filled_qty: Number(target.filled_qty || 0),
    status: 'target_pending', last_error: null });
  if (terminal.has(target.status) && Number(target.filled_qty || 0) < 1) {
    await save({ status: 'needs_attention', last_error: `First target ${target.status}; no automatic replacement` });
  } else if (Number(target.filled_qty || 0) >= 1 && (entry.status === 'filled' || terminal.has(entry.status))) {
    await save({ status: 'first_target_filled' });
  }
}

export async function runOptionPlanBatch(supabase: any, getBroker: any, id: string | null = null) {
  const { data: plans, error } = await supabase.rpc('claim_option_trade_plans', { plan_id: id });
  if (error) throw new Error(error.message);
  const results = await Promise.all((plans || []).map(async (plan: any) => {
    const save = async (patch: any) => {
      const result = await supabase.from('option_trade_plans').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', plan.id).eq('lease_token', plan.lease_token).select('id').single();
      if (result.error || !result.data) throw new Error(result.error?.message || 'Option plan lease lost');
    };
    try {
      const { broker, headers, error } = await getBroker(supabase, plan.user_id, plan.broker_account_id);
      if (error || !broker || !headers) throw new Error(error || 'Broker unavailable');
      if ((broker.base_url || broker.baseUrl || 'https://paper-api.alpaca.markets') !== plan.broker_base_url) throw new Error('Broker environment changed; restore original connection to reconcile');
      await reconcileOptionPlan(plan, {
        save, broker: optionBrokerClient(plan.broker_base_url, headers),
        allowEntry: async () => {
          const { data, error } = await supabase.from('risk_settings').select('kill_switch_enabled, authorized_user_ids').eq('user_id', plan.user_id).maybeSingle();
          if (error) throw new Error(error.message);
          if (data?.kill_switch_enabled || (data?.authorized_user_ids?.length && !data.authorized_user_ids.includes(plan.user_id))) {
            throw new Error('Entry blocked by risk settings');
          }
        },
      });
      await save({ lease_until: null, lease_token: null, next_check_at: new Date(Date.now() + 30_000).toISOString() });
      return { id: plan.id, ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await save({ last_error: message, lease_until: null, lease_token: null, next_check_at: new Date(Date.now() + 60_000).toISOString() });
      return { id: plan.id, ok: false, error: message };
    }
  }));
  return results;
}

import { normalizeOptionTicket } from '../../../src/utils/optionTicket.ts';
import { assertOptionContract } from '../../../src/utils/optionWebhook.ts';
import { optionBrokerClient, OptionBrokerError } from './option_plan_worker.ts';
import { storeOptionPlan, OptionPlanConflict } from './option_plan_store.ts';

export async function handleOptionTicketRoute(req: Request, url: URL, deps: {
  supabase: any; userId: string; getBroker: any; workerReady: () => Promise<boolean>; enqueue: (id: string) => void;
  brokerClient?: typeof optionBrokerClient;
}) {
  const respond = (body: any, status = 200) => ({ body, status });
  const { supabase, userId } = deps;
  try {
    if (req.method === 'GET' && url.pathname.endsWith('/option-plans')) {
      let query = supabase.from('option_trade_plans').select('*').eq('user_id', userId);
      const brokerId = url.searchParams.get('brokerId');
      if (brokerId) query = query.eq('broker_account_id', brokerId);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
      if (error) throw new Error(error.message);
      return respond({ plans: data ?? [] });
    }
    if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return respond({ error: 'Invalid JSON body' }, 400); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return respond({ error: 'Expected a ticket object' }, 400);
    let parsed;
    try { parsed = normalizeOptionTicket(body); } catch (error: any) { return respond({ error: error.message }, 400); }
    if (typeof body.broker_id !== 'string' || !body.broker_id) return respond({ error: 'Select a broker account' }, 400);
    const { broker, headers, error } = await deps.getBroker(supabase, userId, body.broker_id);
    if (error || !broker || !headers) return respond({ error: error || 'Broker unavailable' }, 409);
    const baseUrl = broker.base_url || broker.baseUrl || 'https://paper-api.alpaca.markets';
    const environment = baseUrl === 'https://paper-api.alpaca.markets' ? 'paper' : baseUrl === 'https://api.alpaca.markets' ? 'live' : null;
    if (!environment || body.environment !== environment) return respond({ error: 'Broker environment changed. Select the account and review again.' }, 409);
    const api = (deps.brokerClient ?? optionBrokerClient)(baseUrl, headers);
    const contract = await api(`/v2/options/contracts/${encodeURIComponent(parsed.symbol)}`);
    try { assertOptionContract(contract, parsed); } catch (error: any) { return respond({ error: error.message }, 400); }
    if (url.pathname.endsWith('/preview')) return respond({ instruction: parsed, environment, broker_id: broker.id,
      contract_size: Number(contract.size) || 100 });
    if (typeof body.request_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.request_id)) return respond({ error: 'A stable request_id is required' }, 400);
    if (!await deps.workerReady()) return respond({ error: 'Option reconciliation worker is unavailable' }, 503);
    const { plan, duplicate } = await storeOptionPlan(supabase, {
      parsed, userId, brokerId: broker.id, baseUrl, scope: `manual:${userId}`,
      message: typeof body.message === 'string' ? body.message : JSON.stringify({ symbol: parsed.symbol, entry_price: parsed.entry_price, target_price: parsed.target_price }),
      eventId: body.request_id,
    });
    deps.enqueue(plan.id);
    return respond({ plan, duplicate }, 202);
  } catch (error: any) {
    const status = error instanceof OptionPlanConflict ? 409 : error instanceof OptionBrokerError ? (error.status === 404 ? 400 : 502) : 500;
    return respond({ error: error.message || 'Option request failed' }, status);
  }
}

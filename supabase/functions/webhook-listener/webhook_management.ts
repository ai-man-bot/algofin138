import { decodeWebhookBody, isOptionMessagePayload, optionOrder } from '../../../src/utils/optionWebhook.ts';
import { buildAlpacaOrderFromWebhookPayload } from '../../../src/utils/webhookAlpacaOrders.ts';
import { handleOptionTicketRoute } from './option_ticket_routes.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: any) => { if (error) throw new Error(error.message); };

export function webhookEvent(row: any, names: Map<string, string>, option = false) {
  if (option) return {
    id: row.id, webhook: names.get(row.route_scope.replace('route:', '')) || 'Strategy option webhook',
    timestamp: row.created_at, status: row.status, error: row.last_error,
    payload: { symbol: row.symbol, action: 'buy', quantity: row.quantity, type: 'limit' },
    alpacaOrder: { type: 'limit', status: row.entry_status || row.status, filled_qty: row.entry_filled_qty ?? 0 },
    plan_id: row.id,
  };
  const payload = row.request_payload || {};
  const order = row.response_payload?.alpaca?.response || row.response_payload?.order || {};
  return {
    id: row.id, webhook: names.get(row.route_id) || 'Strategy webhook', timestamp: row.created_at,
    status: row.status, error: row.error_message,
    payload: { symbol: row.symbol || payload.symbol, action: row.side || payload.side || payload.action,
      quantity: payload.qty ?? payload.quantity, type: payload.order_type ?? payload.type },
    alpacaOrder: { type: order.type, status: order.status || row.status,
      filled_qty: order.filled_qty, filled_avg_price: order.filled_avg_price },
  };
}

export async function handleWebhookManagement(req: Request, url: URL, deps: {
  supabase: any; userId: string; baseUrl: string; getBroker: any;
  brokerClient?: Parameters<typeof handleOptionTicketRoute>[2]['brokerClient'];
}) {
  const { supabase: db, userId } = deps;
  const respond = (body: any, status = 200) => ({ body, status });
  const match = url.pathname.match(/\/webhooks(?:\/([^/]+)(?:\/(events|preview))?)?$/);
  if (!match) return respond({ error: 'Route not found' }, 404);
  const [, id, action] = match;
  if (id && id !== 'all' && !uuid.test(id)) return respond({ error: 'Invalid webhook ID' }, 400);
  try {
    const routeQuery = db.from('webhook_routes').select('*').eq('user_id', userId);
    const result = id && id !== 'all' ? await routeQuery.eq('id', id).maybeSingle() : await routeQuery.order('created_at', { ascending: false });
    fail(result.error);
    const routes = id && id !== 'all' ? (result.data ? [result.data] : []) : (result.data || []);
    const route = id && id !== 'all' ? routes[0] : null;
    if (id && id !== 'all' && !route) return respond({ error: 'Webhook not found' }, 404);
    const names = new Map<string, string>(routes.map((item: any) => [item.id, item.name || 'Webhook']));

    if (req.method === 'GET' && action === 'events') {
      let logs = db.from('webhook_order_request_logs').select('id,route_id,created_at,status,error_message,symbol,side,request_payload,response_payload').eq('user_id', userId);
      let plans = db.from('option_trade_plans').select('id,route_scope,created_at,status,last_error,symbol,quantity,entry_status,entry_filled_qty').eq('user_id', userId);
      if (route) { logs = logs.eq('route_id', id); plans = plans.eq('route_scope', `route:${id}`); }
      const [logRows, planRows] = await Promise.all([logs.order('created_at', { ascending: false }).limit(100), plans.order('created_at', { ascending: false }).limit(100)]);
      fail(logRows.error); fail(planRows.error);
      return respond([
        ...(logRows.data || []).filter((row: any) => !row.response_payload?.plan_id).map((row: any) => webhookEvent(row, names)),
        ...(planRows.data || []).filter((row: any) => !row.route_scope.startsWith('manual:')).map((row: any) => webhookEvent(row, names, true)),
      ].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 100));
    }
    if (req.method === 'GET' && !action && !id) {
      const brokers = await db.from('broker_accounts').select('id,connected,base_url').eq('user_id', userId);
      fail(brokers.error);
      return respond(routes.map((item: any) => {
        const broker = (brokers.data || []).find((b: any) => b.id === item.broker_account_id);
        return { id: item.id, name: item.name || 'Webhook', status: item.status, strategyId: item.strategy_id,
          broker_id: item.broker_account_id, environment: broker?.base_url?.includes('paper-api') ? 'paper' : broker?.base_url === 'https://api.alpaca.markets' ? 'live' : null,
          connection_error: !broker?.connected ? 'Select a connected account using Edit webhook.' : null,
          url: `${deps.baseUrl}?token=${encodeURIComponent(item.token)}`, triggers: item.triggers ?? 0,
          lastTriggered: item.last_triggered, createdAt: item.created_at };
      }));
    }
    if (req.method === 'DELETE' && route && !action) {
      const updated = await db.from('webhook_routes').delete().eq('id', id).eq('user_id', userId);
      fail(updated.error);
      return respond({ ok: true, deleted: true });
    }
    if (!['POST', 'PUT'].includes(req.method)) return respond({ error: 'Method not allowed' }, 405);
    let body: any;
    try { body = await req.json(); } catch { return respond({ error: 'Invalid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'Expected an object' }, 400);

    // Stopping delivery must remain possible after a broker disconnects.
    // Only this exact status-only request bypasses account validation.
    if (req.method === 'PUT' && route && !action && body.status === 'inactive' && Object.keys(body).length === 1) {
      const updated = await db.from('webhook_routes').update({ status: 'inactive', updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      fail(updated.error);
      return respond({ ok: true, id, status: 'inactive' });
    }

    if (req.method === 'POST' && action === 'preview' && route) {
      // Preview does not deliver a signal, so an inactive route can be validated.
      if (!route.broker_account_id) return respond({ error: 'Select a broker account using Edit webhook' }, 409);
      const connection = await deps.getBroker(db, userId, route.broker_account_id);
      if (connection.error || !connection.broker) return respond({ error: connection.error || 'Broker unavailable' }, 409);
      let payload;
      try { payload = decodeWebhookBody(typeof body.payload === 'string' ? body.payload : JSON.stringify(body.payload)); }
      catch (error: any) { return respond({ error: error.message }, 400); }
      if (isOptionMessagePayload(payload)) {
        if (['symbol', 'side', 'action', 'qty', 'quantity', 'type', 'order_type', 'orderType', 'limit_price', 'limitPrice', 'price', 'time_in_force', 'timeInForce', 'position_intent'].some(key => payload[key] !== undefined)) {
          return respond({ error: 'Option messages cannot include separate order fields' }, 400);
        }
        const base = connection.broker.base_url || connection.broker.baseUrl;
        const previewUrl = new URL(`${deps.baseUrl}/option-plans/preview`);
        const preview = await handleOptionTicketRoute(new Request(previewUrl, { method: 'POST', body: JSON.stringify({
          ...payload, broker_id: route.broker_account_id, environment: base === 'https://paper-api.alpaca.markets' ? 'paper' : 'live',
        }) }), previewUrl, { ...deps, workerReady: async () => false, enqueue: () => { throw new Error('Preview cannot submit'); } });
        if (preview.status !== 200) return preview;
        const plan = { ...preview.body.instruction, id: 'preview-only', target_time_in_force: 'gtc' };
        return respond({ ok: true, preview_only: true, ...preview.body, entry: optionOrder(plan, 'entry'), first_target: optionOrder(plan, 'target') });
      }
      try { return respond({ ok: true, preview_only: true, order: buildAlpacaOrderFromWebhookPayload(payload, { clientOrderId: 'preview-only' }) }); }
      catch (error: any) { return respond({ error: error.message }, 400); }
    }
    if (action || id === 'all' || (req.method === 'POST' && id) || (req.method === 'PUT' && !route)) return respond({ error: 'Method not allowed' }, 405);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) return respond({ error: 'Enter a webhook name (1–120 characters)' }, 400);
    if (typeof body.broker_id !== 'string' || !body.broker_id) return respond({ error: 'Select an Alpaca account' }, 400);
    const connection = await deps.getBroker(db, userId, body.broker_id);
    if (connection.error || !connection.broker) return respond({ error: connection.error || 'Broker unavailable' }, 409);
    const base = connection.broker.base_url || connection.broker.baseUrl;
    const environment = base === 'https://paper-api.alpaca.markets' ? 'paper' : base === 'https://api.alpaca.markets' ? 'live' : null;
    if (!environment || body.environment !== environment) return respond({ error: 'Account environment changed; review the account again' }, 409);
    if (!['active', 'inactive'].includes(body.status)) return respond({ error: 'Status must be active or inactive' }, 400);
    const values: any = { name: body.name.trim(), broker_account_id: connection.broker.id, broker_type: 'alpaca', status: body.status, updated_at: new Date().toISOString() };
    // Existing strategy associations and tokens are preserved when reconnecting an account.
    const query = route
      ? db.from('webhook_routes').update(values).eq('id', id).eq('user_id', userId)
      : db.from('webhook_routes').insert({ ...values, id: crypto.randomUUID(), token: crypto.randomUUID(), user_id: userId });
    const saved = await query.select('id').single(); fail(saved.error);
    return respond({ ok: true, id: saved.data.id }, route ? 200 : 201);
  } catch (error: any) { return respond({ error: error.message || 'Webhook request failed' }, 500); }
}

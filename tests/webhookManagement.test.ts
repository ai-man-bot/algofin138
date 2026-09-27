import assert from 'node:assert/strict';
import { marketDate } from '../src/utils/optionWebhook.ts';
import { handleWebhookManagement } from '../supabase/functions/webhook-listener/webhook_management.ts';

const owned = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const tables: Record<string, any[]> = {
  webhook_routes: [
    { id: owned, user_id: 'alice', name: 'Owned', token: 'keep-private', status: 'active', broker_account_id: 'paper-1', strategy_id: 'existing-strategy' },
    { id: foreign, user_id: 'bob', name: 'Foreign', token: 'foreign-secret', status: 'active', broker_account_id: 'paper-2' },
  ],
  broker_accounts: [{ id: 'paper-1', user_id: 'alice', connected: true, base_url: 'https://paper-api.alpaca.markets' }],
  webhook_order_request_logs: [
    { id: 'log-1', user_id: 'alice', route_id: owned, created_at: '2026-09-26T10:00:00Z', status: 'submitted', request_payload: { symbol: 'AAPL', quantity: 3, secret: 'hidden' }, response_payload: { alpaca: { response: { status: 'accepted', qty: '3', filled_qty: '0' } } } },
    { id: 'log-2', user_id: 'bob', route_id: foreign, created_at: '2026-09-26T11:00:00Z', request_payload: {} },
  ],
  option_trade_plans: [
    { id: 'plan-1', user_id: 'alice', route_scope: `route:${owned}`, created_at: '2026-09-26T12:00:00Z', status: 'queued', symbol: 'PLTR271016C00150000', quantity: 3, entry_filled_qty: 0 },
    { id: 'manual-1', user_id: 'alice', route_scope: 'manual:alice', created_at: '2026-09-26T13:00:00Z' },
    { id: 'plan-2', user_id: 'bob', route_scope: `route:${foreign}`, created_at: '2026-09-26T14:00:00Z' },
  ],
};
let failTable = '', writes = 0, reads = 0;
const db = { from(table: string) {
  const filters: [string, any][] = [];
  let values: any, mode = '', single = false, count = 1000;
  const run = () => {
    if (table === failTable) return { data: null, error: { message: 'Database unavailable' } };
    let rows = (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value));
    if (mode === 'insert') { writes++; tables[table].push(values); rows = [values]; }
    if (mode === 'update') { writes++; rows.forEach(row => Object.assign(row, values)); }
    return { data: single ? rows[0] || null : rows.slice(0, count), error: null };
  };
  const q: any = {
    select() { return q; }, eq(key: string, value: any) { filters.push([key, value]); return q; }, order() { return q; },
    limit(n: number) { count = n; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; },
    insert(row: any) { mode = 'insert'; values = row; return q; }, update(row: any) { mode = 'update'; values = row; return q; },
    then(resolve: any, reject: any) { return Promise.resolve().then(run).then(resolve, reject); },
  };
  return q;
} };
const deps = { supabase: db, userId: 'alice', baseUrl: 'https://project.supabase.co/functions/v1/webhook-listener',
  getBroker: async (_db: any, user: string, id: string) => {
    assert.equal(user, 'alice');
    const broker = tables.broker_accounts.find(row => row.id === id && row.user_id === user && row.connected);
    return broker ? { broker, headers: {} } : { error: 'Broker unavailable' };
  },
  brokerClient: () => async (_path: string, body?: any) => {
    assert.equal(body, undefined, 'preview must never POST an Alpaca order'); reads++;
    return { symbol: 'PLTR271016C00150000', underlying_symbol: 'PLTR', expiration_date: '2027-10-16', type: 'call', strike_price: '150', status: 'active', tradable: true, size: 100 };
  },
};
const request = (path: string, method = 'GET', body?: any) => {
  const url = new URL(`${deps.baseUrl}/webhooks${path}`);
  return handleWebhookManagement(new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) }), url, deps);
};
const list = await request('');
assert.equal(list.status, 200); assert.equal(list.body.length, 1); assert.equal(list.body[0].broker_id, 'paper-1');
assert.ok(!JSON.stringify(list).includes('foreign-secret'));
assert.equal((await request(`/${foreign}`, 'DELETE')).status, 404);
assert.equal((await request(`/${foreign}`, 'PUT', {})).status, 404);
assert.equal((await request(`/${foreign}/preview`, 'POST', {})).status, 404);
assert.equal(writes, 0);
const events = await request('/all/events');
assert.equal(events.body.length, 2); assert.ok(!JSON.stringify(events).includes('hidden')); assert.ok(!JSON.stringify(events).includes('manual-1'));
assert.equal(events.body.find((row: any) => row.id === 'log-1').alpacaOrder.filled_qty, '0', 'accepted order quantity is not filled quantity');
assert.equal(events.body.find((row: any) => row.id === 'plan-1').alpacaOrder.status, 'queued');
const beforePlans = tables.option_trade_plans.length;
const preview = await request(`/${owned}/preview`, 'POST', { payload: { symbol: 'PLTR271016C00150000', entry_price: '6.65', target_price: '7.65' } });
assert.equal(preview.status, 400, 'unsupported structured order must fail');
const stock = await request(`/${owned}/preview`, 'POST', { payload: { symbol: 'AAPL', side: 'buy', qty: 3, type: 'limit', limit_price: '6.65' } });
assert.equal(stock.body.preview_only, true); assert.equal(writes, 0); assert.equal(tables.option_trade_plans.length, beforePlans);
const badMessage = await request(`/${owned}/preview`, 'POST', { payload: { message: 'PLTR: 150C 10/16: BTO Buy to open at 6.65 with first target above 7.65', qty: 9 } });
assert.equal(badMessage.status, 400);
const malformed = await request(`/${owned}/preview`, 'POST', { payload: 'not an option' });
assert.equal(malformed.status, 400);
const optionUrl = new URL(`${deps.baseUrl}/webhooks/${owned}/preview`);
const expiration = marketDate();
const [current, month, day] = expiration.split('-');
const sameDaySymbol = `PLTR${current.slice(-2)}${month}${day}C00150000`;
const result = await handleWebhookManagement(new Request(optionUrl, { method:'POST',body:JSON.stringify({payload:`PLTR: 150C ${month}/${day}: BTO Buy to open at 6.65 with first target above 7.65`}) }), optionUrl,
  { ...deps, brokerClient: () => async (_path: string, body?: any) => { assert.equal(body,undefined); return {symbol:sameDaySymbol,underlying_symbol:'PLTR',expiration_date:expiration,type:'call',strike_price:'150',status:'active',tradable:true,size:100}; } });
assert.equal(result.status,200); assert.equal(result.body.entry.qty,'3'); assert.equal(result.body.first_target.qty,'1'); assert.equal(result.body.first_target.time_in_force,'gtc');
assert.equal(writes,0); assert.equal(tables.option_trade_plans.length,beforePlans);
const input = { name:'New route', broker_id:'paper-1', environment:'paper', status:'active', user_id:'bob' };
assert.equal((await request('', 'POST', { ...input, broker_id:'paper-2' })).status,409);
assert.equal((await request('', 'POST', { ...input, environment:'live' })).status,409);
assert.equal((await request('', 'POST', input)).status,201);
assert.equal(tables.webhook_routes.at(-1).user_id,'alice');
assert.equal((await request(`/${owned}`, 'PUT', {...input,name:'Updated'})).status,200);
assert.equal(tables.webhook_routes[0].token,'keep-private'); assert.equal(tables.webhook_routes[0].strategy_id,'existing-strategy');
assert.equal((await request(`/${owned}`, 'DELETE')).status,200); assert.equal(tables.webhook_routes[0].status,'inactive');
assert.equal(tables.option_trade_plans.length,beforePlans,'deactivation preserves existing plans');
assert.equal((await request(`/${owned}/preview`, 'POST', {payload:'anything'})).status,409);
failTable='webhook_order_request_logs'; assert.equal((await request('/all/events')).status,500,'database failures must not appear as empty success');
console.log('webhook management ownership, preview-only, lifecycle and truthful event tests passed');

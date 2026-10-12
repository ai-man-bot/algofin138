import assert from 'node:assert/strict';
import { normalizeOptionTicket, optionPlanLabel } from '../src/utils/optionTicket.ts';
import { handleOptionTicketRoute } from '../supabase/functions/webhook-listener/option_ticket_routes.ts';

const date = new Date('2026-09-26T16:00:00Z');
const fields = { symbol: 'PLTR271016C00150000', entry_price: '6.65', target_price: '7.65' };
assert.equal(normalizeOptionTicket(fields, date).expiration, '2027-10-16', 'full year must not be inferred away');
assert.equal(normalizeOptionTicket({ message: 'PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65' }, date).expiration, '2027-05-22');
assert.equal(normalizeOptionTicket({ ...fields, quantity: 5 }, date).quantity, 5, 'entry quantity is configurable');
assert.equal(normalizeOptionTicket({ ...fields, quantity: 5, target_quantity: 2 }, date).target_quantity, 2, 'target quantity is configurable and may be less than entry');
assert.equal(normalizeOptionTicket({ message: 'PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65', quantity: 5, target_quantity: 4 }, date).quantity, 5, 'message tickets accept sizing overrides');
assert.throws(() => normalizeOptionTicket({ ...fields, quantity: 2, target_quantity: 3 }, date), /target_quantity must be/);
for (const invalid of [{ ...fields, quantity: 0 }, { ...fields, quantity: 2.5 }, { ...fields, quantity: 1001 },
  { ...fields, target_price: '1.00' }, { ...fields, entry_price: '1.234' }, { ...fields, symbol: 'PLTR260230C00150000' }, { ...fields, message: 'BTO' },
  { ...fields, side: 'sell' }, { ...fields, order_type: 'market' }]) {
  assert.throws(() => normalizeOptionTicket(invalid, date));
}
assert.match(optionPlanLabel({ status: 'queued', entry_status: null, target_status: null }), /not yet accepted/);
assert.equal(optionPlanLabel({ status: 'entry_pending', entry_status: 'accepted', target_status: null }), 'Entry accepted');

// Exercise actual route handler with in-memory persistence and a mocked broker transport.
const rows: any[] = [];
let brokerReads = 0, enqueued = 0, ready = true;
const queryLog: any[] = [];
const supabase = {
  from(table: string) {
    assert.equal(table, 'option_trade_plans');
    let insert: any = null;
    const filters: [string, any][] = [];
    const query: any = {
      insert(value: any) { insert = value; return query; }, select() { return query; },
      eq(key: string, value: any) { filters.push([key, value]); queryLog.push([key,value]); return query; },
      order() { return query; },
      async limit() { return { data: rows.filter(row => filters.every(([key,value]) => row[key] === value)), error: null }; },
      async single() {
        if (insert) {
          if (rows.some(row => row.delivery_key === insert.delivery_key)) return { error: { code: '23505' } };
          const row = { id: crypto.randomUUID(), status: 'queued', ...insert }; rows.push(row); return { data: row };
        }
        return { data: rows.find(row => filters.every(([key,value]) => row[key] === value)) };
      },
    };
    return query;
  },
};
const deps = {
  supabase, userId: 'owner',
  async getBroker(_db: any, user: string, id: string) {
    assert.equal(user, 'owner');
    if (id !== 'paper-1') return { error: 'Broker unavailable' };
    return { broker: { id, base_url: 'https://paper-api.alpaca.markets' }, headers: {} };
  },
  workerReady: async () => ready,
  enqueue: () => { enqueued++; },
  brokerClient: (_url: string, _headers: Record<string,string>) => async (path: string, body?: any) => {
    assert.equal(body, undefined, 'preview and submission validation never place a broker order');
    assert.ok(path.startsWith('/v2/options/contracts/'));
    brokerReads++;
    return { symbol: fields.symbol, underlying_symbol: 'PLTR', expiration_date: '2027-10-16',
      type: 'call', strike_price: '150', status: 'active', tradable: true, size: '100' };
  },
};
async function request(body: any, preview = false) {
  const url = new URL(`https://app.test/option-plans${preview ? '/preview' : ''}`);
  return handleOptionTicketRoute(new Request(url, { method: 'POST', body: JSON.stringify(body) }), url, deps);
}
{
  const input = { ...fields, broker_id: 'paper-1', environment: 'paper', request_id: crypto.randomUUID() };
  assert.equal((await request(input, true)).status, 200);
  assert.equal(rows.length, 0, 'preview cannot enqueue a plan');
  assert.equal(enqueued, 0);
  assert.equal((await request({ ...input, environment: 'live' })).status, 409);
  assert.equal((await request({ ...input, broker_id: 'someone-else' })).status, 409);
  ready = false;
  assert.equal((await request(input)).status, 503);
  assert.equal(rows.length, 0);
  ready = true;
  const first = await request(input);
  assert.equal(first.status, 202);
  assert.equal(rows[0].user_id, 'owner');
  assert.equal(rows[0].quantity, 3);
  assert.equal(rows[0].target_time_in_force, 'gtc');
  assert.equal((await request(input)).body.duplicate, true);
  assert.equal(rows.length, 1, 'same request after a lost response creates no duplicate');
  assert.equal((await request({ ...input, target_price: '8.00' })).status, 409);
  const sizedInput = { ...fields, quantity: 5, target_quantity: 2, broker_id: 'paper-1', environment: 'paper', request_id: crypto.randomUUID() };
  const sizedPreview = await request(sizedInput, true);
  assert.equal(sizedPreview.status, 200);
  assert.equal(sizedPreview.body.instruction.quantity, 5);
  assert.equal(sizedPreview.body.instruction.target_quantity, 2);
  const sized = await request(sizedInput);
  assert.equal(sized.status, 202);
  assert.equal(sized.body.plan.quantity, 5);
  assert.equal(sized.body.plan.target_quantity, 2);
  assert.equal((await request(sizedInput)).body.duplicate, true, 'the same sized request retries as one delivery');
  assert.equal((await request({ ...sizedInput, target_quantity: 3, request_id: crypto.randomUUID() })).status, 202, 'different sizing is a distinct delivery');
  assert.equal((await request({ ...fields, quantity: 4, broker_id: 'paper-1', environment: 'paper', request_id: crypto.randomUUID() })).status, 202, 'non-default entry size is its own delivery');
  const url = new URL('https://app.test/option-plans?brokerId=paper-1');
  await handleOptionTicketRoute(new Request(url), url, deps);
  assert.ok(queryLog.some(([key,value]) => key === 'user_id' && value === 'owner'));
  assert.ok(queryLog.some(([key,value]) => key === 'broker_account_id' && value === 'paper-1'));
  assert.ok(brokerReads > 0);
}
console.log('option ticket validation, preview, account isolation and idempotency tests passed');

import assert from 'node:assert/strict';
import { parseOptionMessage, decodeWebhookBody, optionOrder, optionDeliveryKey, assertOptionContract, isOptionMessagePayload } from '../src/utils/optionWebhook.ts';
import { reconcileOptionPlan, OptionBrokerError } from '../supabase/functions/webhook-listener/option_plan_worker.ts';

const now = new Date('2026-09-25T18:00:00Z');
const message = 'PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65';
const parsed = parseOptionMessage(message, now);
assert.equal(parsed.symbol, 'PLTR270522C00150000');
assert.equal(parsed.expiration, '2027-05-22');
assert.equal(parsed.entry_price, '6.65');
assert.equal(parsed.target_quantity, 1);
assert.equal(parseOptionMessage('pltr 190.5p 10/16: bto at $6.65 with first target at $7.65', now).symbol, 'PLTR261016P00190500');
assert.equal(parseOptionMessage(message, new Date('2026-05-23T01:00:00Z')).expiration, '2026-05-22');
assert.throws(() => parseOptionMessage(message.replace('5/22', '2/30'), now), /Invalid expiration/);
assert.throws(() => parseOptionMessage(message.replace('7.65', '6.00'), now), /target must exceed/);
assert.throws(() => parseOptionMessage(message.replace('BTO', 'STC'), now), /Expected/);
assert.throws(() => parseOptionMessage(message + ' sell all remaining', now), /Expected/);
assert.deepEqual(decodeWebhookBody(message), { message });
assert.deepEqual(decodeWebhookBody(JSON.stringify(message), 'application/json'), { message });
assert.deepEqual(decodeWebhookBody('{"symbol":"AAPL","qty":1,"side":"buy"}', 'application/json'), { symbol: 'AAPL', qty: 1, side: 'buy' });
assert.throws(() => decodeWebhookBody('{broken', 'application/json'), /Invalid JSON/);
assert.throws(() => decodeWebhookBody('[]'), /Expected/);
assert.equal(isOptionMessagePayload({ symbol: 'AAPL', side: 'buy', qty: 1, message: 'stock entry signal' }), false);
assert.equal(isOptionMessagePayload({ symbol: 'AAPL', side: 'buy', message }), true, 'mixed option instructions must be validated');
assert.equal(isOptionMessagePayload({ message }), true);
assert.equal(await optionDeliveryKey('route', parsed, undefined, now), await optionDeliveryKey('route', { ...parsed }, undefined, now));
assert.notEqual(await optionDeliveryKey('route', parsed, 'a', now), await optionDeliveryKey('route', parsed, 'b', now));
assert.notEqual(await optionDeliveryKey('route', parsed, 'a', now), await optionDeliveryKey('other', parsed, 'a', now));

function fixture() {
  const plan: any = { ...parsed, id: '00000000-0000-0000-0000-000000000001', target_time_in_force: 'gtc', status: 'queued' };
  const orders = new Map<string, any>();
  const posts: any[] = [];
  const contract = { ...parsed, underlying_symbol: parsed.underlying, expiration_date: parsed.expiration,
    type: parsed.option_type, strike_price: parsed.strike, status: 'active', tradable: true };
  const deps = {
    now: () => now,
    save: async (patch: any) => { Object.assign(plan, patch); },
    allowEntry: async () => {},
    broker: async (path: string, body?: any): Promise<any> => {
      if (path.startsWith('/v2/options/contracts/')) return contract;
      if (path.startsWith('/v2/positions/')) return { qty: '3', qty_available: '3' };
      if (body) {
        const leg = body.side === 'buy' ? 'entry' : 'target';
        assert.ok(plan[`${leg}_attempted_at`], 'submission intent must be durable before POST');
        posts.push(body);
        const result = { ...body, id: leg, status: 'new', filled_qty: '0' };
        orders.set(body.client_order_id, result);
        return result;
      }
      const key = decodeURIComponent(path.split('client_order_id=')[1]);
      if (!orders.has(key)) throw new OptionBrokerError('not found', 404);
      return orders.get(key);
    },
  };
  return { plan, orders, posts, deps, contract };
}
const f = fixture();
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.posts.length, 1);
assert.deepEqual(f.posts[0], { symbol: parsed.symbol, qty: '3', side: 'buy', position_intent: 'buy_to_open',
  type: 'limit', limit_price: '6.65', time_in_force: 'day', client_order_id: `opt-${f.plan.id}-e` });
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.posts.length, 1, 'unfilled entry must not create exit');
Object.assign(f.orders.get(optionOrder(f.plan, 'entry').client_order_id), { filled_qty: '1', status: 'partially_filled' });
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.posts.length, 2);
assert.equal(f.posts[1].qty, '1');
assert.equal(f.posts[1].position_intent, 'sell_to_close');
assert.equal(f.posts[1].time_in_force, 'gtc');
assert.equal(f.posts[1].limit_price, '7.65');
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.posts.length, 2, 'repeat reconciliation must not repeat target');
Object.assign(f.orders.get(optionOrder(f.plan, 'target').client_order_id), { filled_qty: '1', status: 'filled' });
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.plan.status, 'target_pending', 'continue tracking the partially filled entry');
Object.assign(f.orders.get(optionOrder(f.plan, 'entry').client_order_id), { filled_qty: '3', status: 'filled' });
await reconcileOptionPlan(f.plan, f.deps);
assert.equal(f.plan.status, 'first_target_filled');
assert.equal(f.plan.entry_filled_qty - f.plan.target_filled_qty, 2);

const canceled = fixture();
await reconcileOptionPlan(canceled.plan, canceled.deps);
Object.assign(canceled.orders.get(optionOrder(canceled.plan, 'entry').client_order_id), { status: 'canceled' });
await reconcileOptionPlan(canceled.plan, canceled.deps);
assert.equal(canceled.plan.status, 'entry_terminal');
assert.equal(canceled.posts.length, 1);

const uncertain = fixture();
const broker = uncertain.deps.broker;
uncertain.deps.broker = async (path, body) => {
  const result = await broker(path, body);
  if (body) throw new Error('Response lost after acceptance');
  return result;
};
await reconcileOptionPlan(uncertain.plan, uncertain.deps);
await reconcileOptionPlan(uncertain.plan, uncertain.deps);
assert.equal(uncertain.posts.length, 1, 'lookup recovers an accepted order after timeout');
assert.equal(uncertain.plan.entry_order_id, 'entry');

const rejected = fixture();
const rejectedBroker = rejected.deps.broker;
let attempts = 0;
rejected.deps.broker = async (path, body) => {
  if (body) { attempts++; throw new OptionBrokerError('insufficient buying power', 403); }
  return rejectedBroker(path, body);
};
await reconcileOptionPlan(rejected.plan, rejected.deps);
rejected.deps.now = () => new Date(now.getTime() + 360_000);
await reconcileOptionPlan(rejected.plan, rejected.deps);
assert.equal(rejected.plan.status, 'needs_attention');
assert.equal(attempts, 1, 'never retry uncertain/rejected POST blindly');

const invalid = fixture();
invalid.contract.tradable = false;
await reconcileOptionPlan(invalid.plan, invalid.deps);
assert.equal(invalid.posts.length, 0);
assert.equal(invalid.plan.status, 'entry_terminal');
assert.throws(() => assertOptionContract({ ...invalid.contract, tradable: true, symbol: 'OTHER' }, parsed));

const blocked = fixture();
blocked.deps.allowEntry = async () => { throw new Error('kill switch'); };
await assert.rejects(() => reconcileOptionPlan(blocked.plan, blocked.deps), /kill switch/);
assert.equal(blocked.posts.length, 0);

const partialCanceled = fixture();
await reconcileOptionPlan(partialCanceled.plan, partialCanceled.deps);
Object.assign(partialCanceled.orders.get(optionOrder(partialCanceled.plan, 'entry').client_order_id), { filled_qty: '1', status: 'canceled' });
await reconcileOptionPlan(partialCanceled.plan, partialCanceled.deps);
assert.equal(partialCanceled.posts.length, 2, 'canceled entry with one fill still gets a target');
Object.assign(partialCanceled.orders.get(optionOrder(partialCanceled.plan, 'target').client_order_id), { status: 'canceled' });
await reconcileOptionPlan(partialCanceled.plan, partialCanceled.deps);
assert.equal(partialCanceled.plan.status, 'needs_attention');
assert.equal(partialCanceled.posts.length, 2, 'do not recreate a canceled exit');

const unavailable = fixture();
await reconcileOptionPlan(unavailable.plan, unavailable.deps);
Object.assign(unavailable.orders.get(optionOrder(unavailable.plan, 'entry').client_order_id), { filled_qty: '3', status: 'filled' });
const unavailableBroker = unavailable.deps.broker;
unavailable.deps.broker = (path, body) => path.startsWith('/v2/positions/') ? Promise.resolve({ qty: '3', qty_available: '0' }) : unavailableBroker(path, body);
await reconcileOptionPlan(unavailable.plan, unavailable.deps);
assert.equal(unavailable.posts.length, 1, 'do not sell contracts reserved by another closing order');
assert.equal(unavailable.plan.status, 'needs_attention');

const persistenceFailure = fixture();
persistenceFailure.deps.save = async () => { throw new Error('database down'); };
await assert.rejects(() => reconcileOptionPlan(persistenceFailure.plan, persistenceFailure.deps), /database down/);
assert.equal(persistenceFailure.posts.length, 0, 'no broker submission without durable intent');

const lookupFailure = fixture();
lookupFailure.deps.broker = async () => { throw new OptionBrokerError('rate limited', 429); };
await assert.rejects(() => reconcileOptionPlan(lookupFailure.plan, lookupFailure.deps), /rate limited/);
assert.equal(lookupFailure.posts.length, 0, 'lookup failure is not proof that an order is absent');
console.log('option webhook and first-target lifecycle tests passed');

import assert from 'node:assert/strict';
import { buildAlpacaOrderFromWebhookPayload } from '../src/utils/webhookAlpacaOrders.ts';

const limitOrder = buildAlpacaOrderFromWebhookPayload(
  {
    symbol: ' soxl ',
    action: 'sell',
    qty: '1',
    type: 'limit',
    limit_price: '177',
  },
  { clientOrderId: 'tv-test-1' },
);

assert.deepEqual(limitOrder, {
  symbol: 'SOXL',
  qty: '1',
  side: 'sell',
  type: 'limit',
  time_in_force: 'day',
  client_order_id: 'tv-test-1',
  limit_price: '177',
});

const marketOrder = buildAlpacaOrderFromWebhookPayload(
  {
    symbol: 'AAPL',
    side: 'buy',
    quantity: 2,
  },
  { clientOrderId: 'tv-test-2' },
);

assert.equal(marketOrder.type, 'market');
assert.equal(marketOrder.qty, '2');

assert.throws(
  () => buildAlpacaOrderFromWebhookPayload({ symbol: 'AAPL', action: 'flat', qty: 1 }, { clientOrderId: 'bad' }),
  /side must be buy or sell/,
);

assert.throws(
  () => buildAlpacaOrderFromWebhookPayload({ symbol: 'AAPL', action: 'buy', qty: 1, type: 'limit' }, { clientOrderId: 'bad' }),
  /limit price must be a positive number/,
);

console.log('webhook Alpaca order tests passed');

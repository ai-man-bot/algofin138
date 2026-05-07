import assert from 'node:assert/strict';
import {
  isRootWebhookIngressPath,
  normalizeBrokerConnectPayload,
} from '../src/utils/webhookRouteMatching.ts';

assert.equal(isRootWebhookIngressPath('/functions/v1/webhook-listener'), true);
assert.equal(isRootWebhookIngressPath('/functions/v1/webhook-listener/'), true);
assert.equal(isRootWebhookIngressPath('/functions/v1/webhook-listener/brokers'), false);
assert.equal(isRootWebhookIngressPath('/functions/v1/webhook-listener/strategy-lab/strategies'), false);

const normalized = normalizeBrokerConnectPayload({
  broker_type: 'alpaca',
  name: 'Alpaca',
  api_key: 'key-1',
  api_secret: 'secret-1',
  paper: false,
});

assert.equal(normalized.brokerType, 'alpaca');
assert.equal(normalized.name, 'Alpaca');
assert.equal(normalized.apiKey, 'key-1');
assert.equal(normalized.apiSecret, 'secret-1');
assert.equal(normalized.paper, false);

assert.throws(
  () => normalizeBrokerConnectPayload({ broker_type: '', api_key: 'key', api_secret: 'secret' }),
  /Broker type is required/,
);
assert.throws(
  () => normalizeBrokerConnectPayload({ broker_type: 'alpaca', api_key: '', api_secret: 'secret' }),
  /API key is required/,
);

console.log('webhook route matching tests passed');

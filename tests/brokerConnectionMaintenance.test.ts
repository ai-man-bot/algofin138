import assert from 'node:assert/strict';
import {
  dedupeBrokerAccounts,
  findConflictingBrokerAccountIds,
} from '../src/utils/brokerConnectionMaintenance.ts';

const duplicateBrokers = [
  {
    id: 'legacy-uuid-row',
    broker_type: 'alpaca',
    account_id: '574b64ca-db6c-4a4a-8272-3fa775429df4',
    created_at: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'alpaca:PA3A82Y1AMF0',
    broker_type: 'alpaca',
    account_id: 'PA3A82Y1AMF0',
    metadata: { account: { account_number: 'PA3A82Y1AMF0' } },
    created_at: '2026-05-07T00:00:00.000Z',
  },
];

const duplicateCredentials = [
  {
    broker_account_id: 'legacy-uuid-row',
    api_key: 'same-key',
    api_secret: 'same-secret',
  },
  {
    broker_account_id: 'alpaca:PA3A82Y1AMF0',
    api_key: 'same-key',
    api_secret: 'same-secret',
  },
];

assert.deepEqual(
  dedupeBrokerAccounts(duplicateBrokers, duplicateCredentials).map((broker) => broker.id),
  ['alpaca:PA3A82Y1AMF0'],
);

assert.deepEqual(
  findConflictingBrokerAccountIds({
    brokers: duplicateBrokers,
    credentials: duplicateCredentials,
    canonicalBrokerAccountId: 'alpaca:PA3A82Y1AMF0',
    brokerType: 'alpaca',
    accountNumber: 'PA3A82Y1AMF0',
    apiKey: 'same-key',
    apiSecret: 'same-secret',
  }),
  ['legacy-uuid-row'],
);

console.log('broker connection maintenance tests passed');

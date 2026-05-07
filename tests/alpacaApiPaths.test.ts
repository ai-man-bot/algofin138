import assert from 'node:assert/strict';
import { buildAlpacaApiPath } from '../src/utils/alpacaApiPaths.ts';

assert.equal(
  buildAlpacaApiPath('/alpaca/account', 'alpaca:PA3A82Y1AMF0'),
  '/alpaca/account?brokerId=alpaca%3APA3A82Y1AMF0',
);

assert.equal(
  buildAlpacaApiPath('/alpaca/orders', 'alpaca:PA3A82Y1AMF0', {
    status: 'all',
    limit: 500,
  }),
  '/alpaca/orders?brokerId=alpaca%3APA3A82Y1AMF0&status=all&limit=500',
);

assert.equal(
  buildAlpacaApiPath('/alpaca/portfolio-history', '', {
    period: '1M',
    timeframe: '1D',
  }),
  '/alpaca/portfolio-history?period=1M&timeframe=1D',
);

console.log('alpaca api path tests passed');

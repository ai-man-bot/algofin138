import assert from 'node:assert/strict';
import {
  buildLegacyBacktestKey,
  buildLegacyStrategyKey,
  buildLegacyStrategyWebhookUrl,
  buildLegacyTradePrefix,
} from '../src/utils/legacyStrategyRoutes.ts';

assert.equal(
  buildLegacyStrategyKey('user-1', 'strategy-1'),
  'user:user-1:strategy:strategy-1',
);

assert.equal(
  buildLegacyBacktestKey('user-1', 'backtest-1'),
  'user:user-1:backtest:backtest-1',
);

assert.equal(
  buildLegacyTradePrefix('user-1'),
  'user:user-1:trade:',
);

assert.equal(
  buildLegacyStrategyWebhookUrl(
    'https://dzboqhobrmzglyuofcyk.supabase.co/',
    'strategy-1',
    'token-1',
  ),
  'https://dzboqhobrmzglyuofcyk.supabase.co/functions/v1/webhook-listener/tradingview-webhook/strategy-1?token=token-1',
);

console.log('legacy strategy route tests passed');

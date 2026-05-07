export function buildLegacyStrategyKey(userId: string, strategyId: string) {
  return `user:${userId}:strategy:${strategyId}`;
}

export function buildLegacyBacktestKey(userId: string, backtestId: string) {
  return `user:${userId}:backtest:${backtestId}`;
}

export function buildLegacyTradePrefix(userId: string) {
  return `user:${userId}:trade:`;
}

export function buildLegacyStrategyWebhookUrl(supabaseUrl: string, strategyId: string, webhookToken: string) {
  const normalized = String(supabaseUrl || '').replace(/\/+$/, '');
  return `${normalized}/functions/v1/webhook-listener/tradingview-webhook/${strategyId}?token=${webhookToken}`;
}

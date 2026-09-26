function cleanPath(path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) return '/';
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function isRootWebhookIngressPath(path: string) {
  return cleanPath(path).endsWith('/webhook-listener');
}

export function extractLegacyTradingViewStrategyId(path: string) {
  const match = cleanPath(path).match(/\/webhook-listener\/tradingview-webhook\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isWebhookIngressPath(path: string) {
  return isRootWebhookIngressPath(path) || extractLegacyTradingViewStrategyId(path) !== null;
}

export function normalizeBrokerConnectPayload(payload: any) {
  const brokerType = String(
    payload?.broker_type ?? payload?.brokerType ?? payload?.brokerId ?? payload?.id ?? '',
  ).trim().toLowerCase();
  const apiKey = String(payload?.api_key ?? payload?.apiKey ?? '').trim();
  const apiSecret = String(payload?.api_secret ?? payload?.apiSecret ?? '').trim();

  if (!brokerType) {
    throw new Error('Broker type is required');
  }

  if (!apiKey) {
    throw new Error('API key is required');
  }

  if (!apiSecret) {
    throw new Error('API secret is required');
  }

  return {
    brokerType,
    name: String(payload?.name || titleCase(brokerType)).trim() || titleCase(brokerType),
    apiKey,
    apiSecret,
    paper: payload?.paper !== false,
  };
}

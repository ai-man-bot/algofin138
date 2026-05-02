import { projectId } from './supabase/info.ts';
import { requestCache } from './requestCache.ts';

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

const DEFAULT_CACHE_TTL_MS = 15_000;
const SLOW_REQUEST_THRESHOLD_MS = 1_000;

type CachedRequestOptions = RequestInit & {
  ttlMs?: number;
  forceRefresh?: boolean;
};

type RequestMetric = {
  path: string;
  method: string;
  durationMs: number;
  ok: boolean;
  status: number;
  timestamp: number;
};

const requestMetrics = new Map<string, RequestMetric>();

let accessToken: string | null =
  typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

let authErrorCallback: (() => void) | null = null;

/* =========================
   AUTH TOKEN MANAGEMENT
========================= */

export function setAccessToken(token: string | null) {
  accessToken = token;

  if (typeof window === 'undefined') return;

  if (token) {
    localStorage.setItem('access_token', token);
  } else {
    localStorage.removeItem('access_token');
  }
}

export function getAccessToken() {
  if (accessToken) return accessToken;
  if (typeof window !== 'undefined') return localStorage.getItem('access_token');
  return null;
}

export function clearAccessToken() {
  accessToken = null;
  requestCache.clear();

  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
  }
}

export function setAuthErrorCallback(callback: (() => void) | null) {
  authErrorCallback = callback;
}

export function getRequestMetrics() {
  return Array.from(requestMetrics.values()).sort((a, b) => b.timestamp - a.timestamp);
}

function recordRequestMetric(metric: RequestMetric) {
  requestMetrics.set(`${metric.method}:${metric.path}`, metric);

  if (metric.durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
    console.info(
      `[api] slow ${metric.method} ${metric.path} ${metric.durationMs.toFixed(0)}ms (status ${metric.status})`,
    );
  }
}

function buildCacheKey(path: string) {
  const token = getAccessToken() || 'anonymous';
  return `${token}:${path}`;
}

function invalidateCache(prefixes: string[]) {
  const token = getAccessToken() || 'anonymous';

  for (const prefix of prefixes) {
    requestCache.invalidate(`${token}:${prefix}`);
  }
}

async function requestJson(path: string, options: RequestInit = {}) {
  const token = getAccessToken();
  const method = String(options.method || 'GET').toUpperCase();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = finishedAt - startedAt;

  const data = await response.json().catch(() => null);

  recordRequestMetric({
    path,
    method,
    durationMs,
    ok: response.ok,
    status: response.status,
    timestamp: Date.now(),
  });

  if (!response.ok) {
    console.error(`API Error on ${path}:`, data);

    if (response.status === 401) {
      clearAccessToken();
      if (authErrorCallback) authErrorCallback();
    }

    throw new Error(data?.error || data?.message || `API error ${response.status}`);
  }

  return data;
}

/* =========================
   CORE REQUEST WRAPPER
========================= */

export async function apiRequest(path: string, options: RequestInit = {}) {
  return requestJson(path, options);
}

async function cachedApiRequest(path: string, options: CachedRequestOptions = {}) {
  const method = String(options.method || 'GET').toUpperCase();

  if (method !== 'GET') {
    return requestJson(path, options);
  }

  const { ttlMs = DEFAULT_CACHE_TTL_MS, forceRefresh = false, ...requestOptions } = options;

  return requestCache.load(
    buildCacheKey(path),
    () => requestJson(path, requestOptions),
    { ttlMs, forceRefresh },
  );
}

function mutate(path: string, options: RequestInit, invalidatePrefixes: string[] = []) {
  return requestJson(path, options).then((result) => {
    if (invalidatePrefixes.length > 0) {
      invalidateCache(invalidatePrefixes);
    }

    return result;
  });
}

/* =========================
   BROKERS
========================= */

export const brokersAPI = {
  getAll: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/brokers', { method: 'GET', ttlMs: 30_000, ...options }),

  connect: (
    brokerTypeOrPayload: any,
    name?: string,
    apiKey?: string,
    apiSecret?: string,
    paper = true
  ) => {
    const payload =
      typeof brokerTypeOrPayload === 'object'
        ? brokerTypeOrPayload
        : {
            broker_type: brokerTypeOrPayload,
            brokerType: brokerTypeOrPayload,
            name,
            api_key: apiKey,
            apiKey,
            api_secret: apiSecret,
            apiSecret,
            paper,
          };

    return mutate('/brokers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/brokers', '/dashboard', '/alpaca']);
  },

  disconnect: (id: string) =>
    mutate(`/brokers/${id}`, {
      method: 'DELETE',
    }, ['/brokers', '/dashboard', '/alpaca']),
};

/* =========================
   DASHBOARD
========================= */

export const dashboardAPI = {
  getMetrics: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/dashboard/metrics', { method: 'GET', ...options }),
  getEquityCurve: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/dashboard/equity-curve', { method: 'GET', ...options }),
  getPositions: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/dashboard/positions', { method: 'GET', ...options }),
  getRecentOrders: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/dashboard/recent-orders', { method: 'GET', ...options }),
};

/* =========================
   ALPACA
========================= */

export const alpacaAPI = {
  getAccount: (_brokerId?: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest('/alpaca/account', { method: 'GET', ttlMs: 10_000, ...options }),

  getPositions: (_brokerId?: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest('/alpaca/positions', { method: 'GET', ttlMs: 10_000, ...options }),

  getOrders: (_brokerId?: string, status = 'all', limit = 50, options: CachedRequestOptions = {}) =>
    cachedApiRequest(`/alpaca/orders?status=${status}&limit=${limit}`, {
      method: 'GET',
      ttlMs: 10_000,
      ...options,
    }),

  getPortfolioHistory: (
    _brokerId?: string,
    period = '1M',
    timeframe = '1D',
    startDate?: string,
    endDate?: string
  ) => {
    const params = new URLSearchParams();
    params.set('period', period);
    params.set('timeframe', timeframe);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    return cachedApiRequest(`/alpaca/portfolio-history?${params.toString()}`, {
      method: 'GET',
      ttlMs: 30_000,
    });
  },

  getQuote: (symbol: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest(`/alpaca/quote/${encodeURIComponent(symbol)}`, {
      method: 'GET',
      ttlMs: 5_000,
      ...options,
    }),

  getQuotes: (symbols: string[]) =>
    requestJson('/alpaca/quotes', {
      method: 'POST',
      body: JSON.stringify({ symbols }),
    }),
};

/* =========================
   STRATEGIES
========================= */

export const strategiesAPI = {
  getAll: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/strategies', { method: 'GET', ttlMs: 30_000, ...options }),

  create: (payload: any) =>
    mutate('/strategies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/strategies', '/analytics', '/trades']),

  update: (id: string, payload: any) =>
    mutate(`/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, ['/strategies', '/analytics', '/trades']),

  delete: (id: string) =>
    mutate(`/strategies/${id}`, {
      method: 'DELETE',
    }, ['/strategies', '/analytics', '/trades']),

  backtest: (id: string, config: any) =>
    requestJson(`/strategies/${id}/backtest`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getBacktests: (id: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest(`/strategies/${id}/backtests`, { method: 'GET', ttlMs: 30_000, ...options }),

  getTrades: (id: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest(`/strategies/${id}/trades`, { method: 'GET', ttlMs: 10_000, ...options }),

  syncTrades: (id: string) =>
    mutate(`/strategies/${id}/sync-trades`, {
      method: 'POST',
    }, ['/strategies', '/trades', '/analytics', '/dashboard']),

  clearRiskSettings: () =>
    mutate('/strategies/clear-risk-settings', {
      method: 'POST',
    }, ['/strategies']),
};

/* =========================
   TRADES
========================= */

export const tradesAPI = {
  getAll: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/trades', { method: 'GET', ttlMs: 10_000, ...options }),

  create: (payload: any) =>
    mutate('/trades', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/trades', '/analytics', '/dashboard']),

  syncAll: () =>
    mutate('/trades/sync-all', {
      method: 'POST',
    }, ['/trades', '/analytics', '/dashboard']),
};

/* =========================
   WEBHOOKS
========================= */

export const webhooksAPI = {
  getAll: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/webhooks', { method: 'GET', ttlMs: 30_000, ...options }),

  create: (payload: any) =>
    mutate('/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/webhooks']),

  delete: (id: string) =>
    mutate(`/webhooks/${id}`, {
      method: 'DELETE',
    }, ['/webhooks']),

  getEvents: (id: string, options: CachedRequestOptions = {}) =>
    cachedApiRequest(`/webhooks/${id}/events`, { method: 'GET', ttlMs: 10_000, ...options }),

  getAllEvents: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/webhooks/all/events', { method: 'GET', ttlMs: 10_000, ...options }),

  backfillEvents: () =>
    mutate('/backfill-webhook-events', {
      method: 'POST',
    }, ['/webhooks']),
};

export const testWebhook = (payload: any = {}) =>
  apiRequest('/test-webhook', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/* =========================
   NOTIFICATIONS
========================= */

export const notificationsAPI = {
  getAll: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/notifications', { method: 'GET', ttlMs: 10_000, ...options }),

  create: (payload: any) =>
    mutate('/notifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/notifications', '/notification-settings']),

  markRead: (id: string) =>
    mutate(`/notifications/${id}/read`, {
      method: 'PUT',
    }, ['/notifications']),

  markAllRead: () =>
    mutate('/notifications/mark-all-read', {
      method: 'POST',
    }, ['/notifications']),

  delete: (id: string) =>
    mutate(`/notifications/${id}`, {
      method: 'DELETE',
    }, ['/notifications']),

  getPreferences: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/notifications/preferences', { method: 'GET', ttlMs: 30_000, ...options }),

  updatePreferences: (payload: any) =>
    mutate('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }, ['/notifications/preferences']),

  getSettings: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/notification-settings', { method: 'GET', ttlMs: 30_000, ...options }),

  updateSettings: (payload: any) =>
    mutate('/notification-settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, ['/notification-settings']),
};

/* =========================
   ANALYTICS
========================= */

export const analyticsAPI = {
  getPortfolio: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/analytics/portfolio', { method: 'GET', ttlMs: 10_000, ...options }),
  getMetrics: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/analytics/portfolio', { method: 'GET', ttlMs: 10_000, ...options }),
  getPerformance: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/analytics/portfolio', { method: 'GET', ttlMs: 10_000, ...options }),
  getTradeStats: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/analytics/portfolio', { method: 'GET', ttlMs: 10_000, ...options }),
};

/* =========================
   MCP
========================= */

export const mcpAPI = {
  getTools: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/mcp/tools', { method: 'GET', ttlMs: 30_000, ...options }),

  execute: (payload: any) =>
    apiRequest('/mcp/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getInfo: (options: CachedRequestOptions = {}) =>
    cachedApiRequest('/mcp/info', { method: 'GET', ttlMs: 30_000, ...options }),
};

/* =========================
   TRADE ASSISTANT
========================= */

export const tradeAssistantAPI = {
  parse: (input: string, brokerAccountId?: string) =>
    apiRequest('/trade-assistant/parse', {
      method: 'POST',
      body: JSON.stringify({
        input,
        broker_account_id: brokerAccountId,
      }),
    }),

  confirm: (requestId: string) =>
    apiRequest('/trade-assistant/confirm', {
      method: 'POST',
      body: JSON.stringify({
        request_id: requestId,
      }),
    }),
};

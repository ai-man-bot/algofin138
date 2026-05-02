import { projectId } from './supabase/info';

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

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

  if (typeof window !== 'undefined') {
    localStorage.removeItem('access_token');
  }
}

export function setAuthErrorCallback(callback: (() => void) | null) {
  authErrorCallback = callback;
}

/* =========================
   CORE REQUEST WRAPPER
========================= */

export async function apiRequest(path: string, options: RequestInit = {}) {
  const token = getAccessToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => null);

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
   BROKERS
========================= */

export const brokersAPI = {
  getAll: () => apiRequest('/brokers', { method: 'GET' }),

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

    return apiRequest('/brokers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  disconnect: (id: string) =>
    apiRequest(`/brokers/${id}`, {
      method: 'DELETE',
    }),
};

/* =========================
   DASHBOARD
========================= */

export const dashboardAPI = {
  getMetrics: () => apiRequest('/dashboard/metrics', { method: 'GET' }),

  getEquityCurve: () => apiRequest('/dashboard/equity-curve', { method: 'GET' }),

  getPositions: () => apiRequest('/dashboard/positions', { method: 'GET' }),

  getRecentOrders: () => apiRequest('/dashboard/recent-orders', { method: 'GET' }),
};

/* =========================
   ALPACA
========================= */

export const alpacaAPI = {
  getAccount: (_brokerId?: string) =>
    apiRequest('/alpaca/account', { method: 'GET' }),

  getPositions: (_brokerId?: string) =>
    apiRequest('/alpaca/positions', { method: 'GET' }),

  getOrders: (_brokerId?: string, status = 'all', limit = 50) =>
    apiRequest(`/alpaca/orders?status=${status}&limit=${limit}`, { method: 'GET' }),

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

    return apiRequest(`/alpaca/portfolio-history?${params.toString()}`, {
      method: 'GET',
    });
  },

  getQuote: (symbol: string) =>
    apiRequest(`/alpaca/quote/${encodeURIComponent(symbol)}`, { method: 'GET' }),
};

/* =========================
   STRATEGIES
========================= */

export const strategiesAPI = {
  getAll: () => apiRequest('/strategies', { method: 'GET' }),

  create: (payload: any) =>
    apiRequest('/strategies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (id: string, payload: any) =>
    apiRequest(`/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  delete: (id: string) =>
    apiRequest(`/strategies/${id}`, {
      method: 'DELETE',
    }),

  backtest: (id: string, config: any) =>
    apiRequest(`/strategies/${id}/backtest`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getBacktests: (id: string) =>
    apiRequest(`/strategies/${id}/backtests`, {
      method: 'GET',
    }),

  getTrades: (id: string) =>
    apiRequest(`/strategies/${id}/trades`, {
      method: 'GET',
    }),

  syncTrades: (id: string) =>
    apiRequest(`/strategies/${id}/sync-trades`, {
      method: 'POST',
    }),
};

/* =========================
   TRADES
========================= */

export const tradesAPI = {
  getAll: () => apiRequest('/trades', { method: 'GET' }),

  create: (payload: any) =>
    apiRequest('/trades', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  syncAll: () =>
    apiRequest('/trades/sync-all', {
      method: 'POST',
    }),
};

/* =========================
   WEBHOOKS
========================= */

export const webhooksAPI = {
  getAll: () => apiRequest('/webhooks', { method: 'GET' }),

  create: (payload: any) =>
    apiRequest('/webhooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  delete: (id: string) =>
    apiRequest(`/webhooks/${id}`, {
      method: 'DELETE',
    }),

  getEvents: (id: string) =>
    apiRequest(`/webhooks/${id}/events`, {
      method: 'GET',
    }),

  getAllEvents: () =>
    apiRequest('/webhooks/all/events', {
      method: 'GET',
    }),
};

/* =========================
   NOTIFICATIONS
========================= */

export const notificationsAPI = {
  getAll: () => apiRequest('/notifications', { method: 'GET' }),

  create: (payload: any) =>
    apiRequest('/notifications', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  markRead: (id: string) =>
    apiRequest(`/notifications/${id}/read`, {
      method: 'PUT',
    }),

  markAllRead: () =>
    apiRequest('/notifications/mark-all-read', {
      method: 'POST',
    }),

  delete: (id: string) =>
    apiRequest(`/notifications/${id}`, {
      method: 'DELETE',
    }),

  getPreferences: () =>
    apiRequest('/notifications/preferences', {
      method: 'GET',
    }),

  updatePreferences: (payload: any) =>
    apiRequest('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
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

/* =========================
   WEBHOOK TEST HELPER
========================= */

export const testWebhook = (payload: any = {}) =>
  apiRequest('/test-webhook', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
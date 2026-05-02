import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from './supabase/info';
import { buildFunctionUrl } from './supabaseUrls';

const supabaseUrl = `https://${projectId}.supabase.co`;

export const supabase = createClient(supabaseUrl, publicAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function getAuthHeader() {
  const token = await getAccessToken();
  return token ? `Bearer ${token}` : `Bearer ${publicAnonKey}`;
}

type ApiRequestOptions = RequestInit & {
  skipAuth?: boolean;
};

export async function apiRequest(path: string, options: ApiRequestOptions = {}) {
  const { skipAuth, headers, ...rest } = options;
  const url = path.startsWith('http') ? path : buildFunctionUrl(path);
  const authHeader = await getAuthHeader();

  console.log(`API ${rest.method || 'GET'} ${path}`);
  console.log(`  Token used: ${authHeader.slice(7, 43)}... (length: ${authHeader.length - 7})`);
  console.log(`  Is anon key: ${authHeader.includes(publicAnonKey)}`);
  console.log(`  Public anon key: ${publicAnonKey.slice(0, 28)}...`);

  const response = await fetch(url, {
    ...rest,
    headers: {
      ...(skipAuth ? {} : { Authorization: authHeader }),
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
  });

  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    console.error(`API Error on ${path}:`, data);
    const message = data?.error || data?.message || `Request failed with ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function withQuery(path: string, params: Record<string, any>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const authAPI = {
  signUp: async (email: string, password: string, name?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (error) throw error;
    return data;
  },

  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  getSession: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  getUser: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },
};

export const brokersAPI = {
  getAll: async () => apiRequest('/brokers'),

  connect: async (brokerId: string, name: string, apiKey: string, apiSecret: string, paper = true) =>
    apiRequest('/brokers', {
      method: 'POST',
      body: JSON.stringify({
        brokerId,
        broker_id: brokerId,
        brokerType: brokerId,
        broker_type: brokerId,
        name,
        apiKey,
        api_key: apiKey,
        apiSecret,
        api_secret: apiSecret,
        paper,
      }),
    }),

  disconnect: async (brokerId: string) =>
    apiRequest(`/brokers/${encodeURIComponent(brokerId)}`, {
      method: 'DELETE',
    }),
};

export const dashboardAPI = {
  getMetrics: async () => apiRequest('/dashboard/metrics'),
  getEquityCurve: async () => apiRequest('/dashboard/equity-curve'),
  getPositions: async () => apiRequest('/dashboard/positions'),
  getRecentOrders: async () => apiRequest('/dashboard/recent-orders'),
};

export const alpacaAPI = {
  getAccount: async (brokerId?: string) =>
    apiRequest(withQuery('/alpaca/account', { brokerId, broker_id: brokerId })),

  getPositions: async (brokerId?: string) =>
    apiRequest(withQuery('/alpaca/positions', { brokerId, broker_id: brokerId })),

  getPortfolioHistory: async (
    brokerId?: string,
    period = '1M',
    timeframe = '1D',
    startDate?: string,
    endDate?: string,
  ) =>
    apiRequest(
      withQuery('/alpaca/portfolio-history', {
        brokerId,
        broker_id: brokerId,
        period,
        timeframe,
        start_date: startDate,
        end_date: endDate,
        startDate,
        endDate,
      }),
    ),

  getOrders: async (brokerId?: string, status = 'all', limit = 50) =>
    apiRequest(withQuery('/alpaca/orders', { brokerId, broker_id: brokerId, status, limit })),

  getActivities: async (brokerId?: string, activityTypes = 'FILL') =>
    apiRequest(withQuery('/alpaca/activities', { brokerId, broker_id: brokerId, activity_types: activityTypes })),

  getQuote: async (symbol: string, brokerId?: string) =>
    apiRequest(withQuery(`/alpaca/quote/${encodeURIComponent(symbol)}`, { brokerId, broker_id: brokerId })),

  getQuotes: async (symbols: string[], brokerId?: string) =>
    apiRequest('/alpaca/quotes', {
      method: 'POST',
      body: JSON.stringify({ symbols, brokerId, broker_id: brokerId }),
    }),
};

export const tradesAPI = {
  getAll: async () => apiRequest('/trades'),

  create: async (trade: any) =>
    apiRequest('/trades', {
      method: 'POST',
      body: JSON.stringify(trade),
    }),

  syncAll: async () =>
    apiRequest('/trades/sync-all', {
      method: 'POST',
    }),
};

export const strategiesAPI = {
  getAll: async () => apiRequest('/strategies'),

  create: async (strategy: any) =>
    apiRequest('/strategies', {
      method: 'POST',
      body: JSON.stringify(strategy),
    }),

  update: async (strategyId: string, updates: any) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: async (strategyId: string) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}`, {
      method: 'DELETE',
    }),

  backtest: async (strategyId: string, config: any) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}/backtest`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  getBacktests: async (strategyId: string) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}/backtests`),

  getTrades: async (strategyId: string) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}/trades`),

  syncTrades: async (strategyId: string) =>
    apiRequest(`/strategies/${encodeURIComponent(strategyId)}/sync-trades`, {
      method: 'POST',
    }),
};

export const webhooksAPI = {
  getAll: async () => apiRequest('/webhooks'),

  create: async (webhook: any) =>
    apiRequest('/webhooks', {
      method: 'POST',
      body: JSON.stringify(webhook),
    }),

  delete: async (webhookId: string) =>
    apiRequest(`/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    }),

  getEvents: async (webhookId: string) =>
    apiRequest(`/webhooks/${encodeURIComponent(webhookId)}/events`),

  getAllEvents: async () => apiRequest('/webhooks/all/events'),
};

export const notificationsAPI = {
  getAll: async () => apiRequest('/notifications'),

  create: async (notification: any) =>
    apiRequest('/notifications', {
      method: 'POST',
      body: JSON.stringify(notification),
    }),

  markRead: async (notificationId: string) =>
    apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: 'PATCH',
    }),

  markAllRead: async () =>
    apiRequest('/notifications/mark-all-read', {
      method: 'POST',
    }),

  delete: async (notificationId: string) =>
    apiRequest(`/notifications/${encodeURIComponent(notificationId)}`, {
      method: 'DELETE',
    }),

  getPreferences: async () => apiRequest('/notifications/preferences'),

  updatePreferences: async (preferences: any) =>
    apiRequest('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
};

export const tradeAssistantAPI = {
  parse: async (input: string, brokerAccountId?: string) =>
    apiRequest('/trade-assistant/parse', {
      method: 'POST',
      body: JSON.stringify({
        input,
        raw_input: input,
        brokerAccountId,
        broker_account_id: brokerAccountId,
      }),
    }),

  confirm: async (requestId: string) =>
    apiRequest('/trade-assistant/confirm', {
      method: 'POST',
      body: JSON.stringify({
        requestId,
        request_id: requestId,
      }),
    }),
};

export default {
  authAPI,
  brokersAPI,
  dashboardAPI,
  alpacaAPI,
  tradesAPI,
  strategiesAPI,
  webhooksAPI,
  notificationsAPI,
  tradeAssistantAPI,
  apiRequest,
  getAccessToken,
};

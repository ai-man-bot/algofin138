import { publicAnonKey } from './supabase/info';
import { functionBaseUrl } from './supabaseUrls';
import { requestCache } from './requestCache';

export const API_BASE = functionBaseUrl;
const DEFAULT_CACHE_TTL_MS = 15_000;

// Store access token in memory
let accessToken: string | null = null;

// Optional callback for auth errors
let onAuthError: (() => void) | null = null;

export function setAuthErrorCallback(callback: () => void) {
  onAuthError = callback;
}

export function setAccessToken(token: string | null) {
  const previousToken = accessToken;
  accessToken = token;
  if (previousToken !== token) {
    requestCache.clear();
  }
  // Also store in localStorage for persistence
  if (token) {
    localStorage.setItem('access_token', token);
    console.log('Access token set:', token ? `${token.substring(0, 20)}...` : 'empty');
  } else {
    localStorage.removeItem('access_token');
    console.log('Access token cleared');
  }
}

export function getAccessToken() {
  // Try memory first, then fall back to localStorage
  if (!accessToken) {
    accessToken = localStorage.getItem('access_token');
  }
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  localStorage.removeItem('access_token');
  requestCache.clear();
  console.log('Access token cleared from memory and localStorage');
}

function buildCacheKey(endpoint: string, method: string) {
  return `${method}:${endpoint}`;
}

async function fetchJSON(endpoint: string, options: RequestInit, tokenToUse: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  };

  headers['Authorization'] = `Bearer ${tokenToUse}`;
  
  console.log(`API ${options.method || 'GET'} ${endpoint}`);
  console.log(`  Token used: ${tokenToUse.substring(0, 30)}... (length: ${tokenToUse.length})`);
  console.log(`  Is anon key: ${tokenToUse === publicAnonKey}`);
  console.log(`  Public anon key: ${publicAnonKey.substring(0, 30)}...`);

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`API Error on ${endpoint}:`, error);
    
    // If we get an auth error and we're using a custom JWT (not anon key), trigger auto-logout
    if (response.status === 401 && accessToken && accessToken !== publicAnonKey) {
      console.error('⚠️ AUTHENTICATION FAILED - Invalid user JWT detected');
      if (onAuthError) {
        onAuthError();
      }
    }
    
    // Extract the error message more carefully
    const errorMessage = error.error || error.message || 'Request failed';
    throw new Error(errorMessage);
  }

  return response.json();
}

async function fetchAPI(
  endpoint: string,
  options: RequestInit & { cacheTtlMs?: number; forceRefresh?: boolean } = {},
) {
  const currentToken = getAccessToken();
  const tokenToUse = currentToken || publicAnonKey;
  const method = (options.method || 'GET').toUpperCase();

  if (method === 'GET') {
    return requestCache.load(
      buildCacheKey(endpoint, method),
      () => fetchJSON(endpoint, { ...options, method }, tokenToUse),
      {
        ttlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
        forceRefresh: options.forceRefresh,
      },
    );
  }

  const result = await fetchJSON(endpoint, { ...options, method }, tokenToUse);
  requestCache.clear();
  return result;
}

// Auth API
export const authAPI = {
  signup: (email: string, password: string, name: string) =>
    fetchAPI('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    fetchAPI('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
};

// Dashboard API
export const dashboardAPI = {
  getMetrics: () => fetchAPI('/dashboard/metrics'),
  getEquityCurve: () => fetchAPI('/dashboard/equity-curve'),
  getPositions: () => fetchAPI('/dashboard/positions'),
  getRecentOrders: () => fetchAPI('/dashboard/recent-orders'),
};

// Trades API
export const tradesAPI = {
  getAll: () => fetchAPI('/trades'),
  create: (trade: any) =>
    fetchAPI('/trades', {
      method: 'POST',
      body: JSON.stringify(trade),
    }),
  syncAll: () =>
    fetchAPI('/trades/sync-all', {
      method: 'POST',
    }),
};

// Analytics API
export const analyticsAPI = {
  getPortfolio: () => fetchAPI('/analytics/portfolio'),
};

// Strategies API
export const strategiesAPI = {
  getAll: () => fetchAPI('/strategies'),
  create: (strategy: any) =>
    fetchAPI('/strategies', {
      method: 'POST',
      body: JSON.stringify(strategy),
    }),
  update: (id: string, updates: any) =>
    fetchAPI(`/strategies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),
  delete: (id: string) =>
    fetchAPI(`/strategies/${id}`, {
      method: 'DELETE',
    }),
  backtest: (id: string, config: { startDate: string, endDate: string, initialCapital: number }) =>
    fetchAPI(`/strategies/${id}/backtest`, {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  getBacktests: (id: string) => fetchAPI(`/strategies/${id}/backtests`),
  getTrades: (id: string) => fetchAPI(`/strategies/${id}/trades`),
  syncTrades: (id: string) => 
    fetchAPI(`/strategies/${id}/sync-trades`, {
      method: 'POST',
    }),
};

// Webhooks API
export const webhooksAPI = {
  getAll: () => fetchAPI('/webhooks'),
  create: (webhook: any) =>
    fetchAPI('/webhooks', {
      method: 'POST',
      body: JSON.stringify(webhook),
    }),
  getEvents: (id: string) => fetchAPI(`/webhooks/${id}/events`),
  backfillEvents: () =>
    fetchAPI('/backfill-webhook-events', {
      method: 'POST',
    }),
  delete: (id: string) =>
    fetchAPI(`/webhooks/${id}`, {
      method: 'DELETE',
    }),
};

// Notifications API
export const notificationsAPI = {
  getAll: () => fetchAPI('/notifications'),
  getSettings: () => fetchAPI('/notification-settings'),
  saveSettings: (settings: any) =>
    fetchAPI('/notification-settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  create: (notification: any) =>
    fetchAPI('/notifications', {
      method: 'POST',
      body: JSON.stringify(notification),
    }),
  markAsRead: (id: string) =>
    fetchAPI(`/notifications/${id}/read`, {
      method: 'PATCH',
    }),
  markAllAsRead: () =>
    fetchAPI('/notifications/mark-all-read', {
      method: 'POST',
    }),
  delete: (id: string) =>
    fetchAPI(`/notifications/${id}`, {
      method: 'DELETE',
    }),
  getPreferences: () => fetchAPI('/notifications/preferences'),
  updatePreferences: (preferences: any) =>
    fetchAPI('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
};

// Brokers API
export const brokersAPI = {
  getAll: () => fetchAPI('/brokers'),
  connect: (brokerId: string, name: string, apiKey: string, apiSecret: string) =>
    fetchAPI('/brokers', {
      method: 'POST',
      body: JSON.stringify({ brokerId, name, apiKey, apiSecret }),
    }),
  disconnect: (id: string) =>
    fetchAPI(`/brokers/${id}`, {
      method: 'DELETE',
    }),
};

// Alpaca API
export const alpacaAPI = {
  getAccount: (brokerId?: string) => {
    const url = brokerId ? `/alpaca/account?brokerId=${encodeURIComponent(brokerId)}` : '/alpaca/account';
    return fetchAPI(url);
  },
  getPositions: (brokerId?: string) => {
    const url = brokerId ? `/alpaca/positions?brokerId=${encodeURIComponent(brokerId)}` : '/alpaca/positions';
    return fetchAPI(url);
  },
  getPortfolioHistory: (brokerId?: string, period?: string, timeframe?: string, startDate?: string, endDate?: string) => {
    let url = '/alpaca/portfolio-history';
    const params = new URLSearchParams();
    
    if (brokerId) {
      params.append('brokerId', brokerId);
    }
    if (startDate && endDate) {
      params.append('start_date', startDate);
      params.append('end_date', endDate);
    } else if (period) {
      params.append('period', period);
    }
    
    if (timeframe) {
      params.append('timeframe', timeframe);
    }
    
    const queryString = params.toString();
    return fetchAPI(queryString ? `${url}?${queryString}` : url);
  },
  getOrders: (brokerId?: string, status = 'closed', limit = 500) => {
    const params = new URLSearchParams();
    if (brokerId) params.append('brokerId', brokerId);
    params.append('status', status);
    params.append('limit', limit.toString());
    return fetchAPI(`/alpaca/orders?${params.toString()}`);
  },
  getActivities: (activityTypes = 'FILL') => fetchAPI(`/alpaca/activities?activity_types=${activityTypes}`),
  getQuote: (symbol: string) => fetchAPI(`/alpaca/quote/${symbol}`),
  getQuotes: (symbols: string[]) =>
    fetchAPI('/alpaca/quotes', {
      method: 'POST',
      body: JSON.stringify({ symbols }),
    }),
};

// Test Webhook API - proxy webhook test to avoid CORS
export async function testWebhook(webhookUrl: string, payload: any) {
  return fetchAPI('/test-webhook', {
    method: 'POST',
    body: JSON.stringify({ webhookUrl, payload }),
  });
}

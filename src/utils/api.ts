import { projectId } from './supabase/info';

const BASE_URL = `https://${projectId}.supabase.co/functions/v1/webhook-listener`;

/* =========================
   AUTH TOKEN MANAGEMENT
========================= */

let accessToken: string | null =
  typeof window !== 'undefined'
    ? localStorage.getItem('access_token')
    : null;

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

  if (typeof window !== 'undefined') {
    return localStorage.getItem('access_token');
  }

  return null;
}

/* =========================
   CORE REQUEST WRAPPER
========================= */

async function apiRequest(path: string, options: RequestInit = {}) {
  const token = getAccessToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error ||
        data?.message ||
        `API error (${res.status})`
    );
  }

  return data;
}

/* =========================
   BROKERS API
========================= */

export const brokersAPI = {
  getAll: () => apiRequest('/brokers', { method: 'GET' }),

  connect: (payload: any) =>
    apiRequest('/brokers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  disconnect: (id: string) =>
    apiRequest(`/brokers/${id}`, {
      method: 'DELETE',
    }),
};

/* =========================
   DASHBOARD API
========================= */

export const dashboardAPI = {
  getMetrics: (brokerId: string) =>
    apiRequest(`/dashboard/metrics?broker_id=${brokerId}`),
};

/* =========================
   TRADES API
========================= */

export const tradesAPI = {
  getAll: () => apiRequest('/trades'),
};

/* =========================
   ALPACA API (direct passthrough)
========================= */

export const alpacaAPI = {
  getAccount: (brokerId: string) =>
    apiRequest(`/alpaca/account?broker_id=${brokerId}`),

  getPositions: (brokerId: string) =>
    apiRequest(`/alpaca/positions?broker_id=${brokerId}`),

  getOrders: (brokerId: string) =>
    apiRequest(`/alpaca/orders?broker_id=${brokerId}`),
};

/* =========================
   TRADE ASSISTANT API
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
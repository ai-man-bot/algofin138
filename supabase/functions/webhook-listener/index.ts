import { createClient } from "npm:@supabase/supabase-js@2.45.2";
import { handleStrategyLabRoutes } from "./strategy_lab_routes.ts";
import { normalizeBrokerSnapshot } from "../../../src/utils/brokerModels.ts";
import { createOrderLifecycleFromSignal } from "../../../src/utils/orderLifecycle.ts";
import {
  buildOmsOrderInsertRow,
  buildRiskAuditInsertRow,
  buildStrategyLabSignalFromPayload,
  buildWebhookEventStatusUpdate,
} from "../../../src/utils/orderRoutingPersistence.ts";
import {
  extractLegacyTradingViewStrategyId,
  isWebhookIngressPath,
  normalizeBrokerConnectPayload,
} from "../../../src/utils/webhookRouteMatching.ts";
import {
  dedupeBrokerAccounts,
  findConflictingBrokerAccountIds,
} from "../../../src/utils/brokerConnectionMaintenance.ts";
import {
  buildLegacyBacktestKey,
  buildLegacyStrategyKey,
  buildLegacyStrategyWebhookUrl,
  buildLegacyTradePrefix,
} from "../../../src/utils/legacyStrategyRoutes.ts";
import { buildAlpacaOrderFromWebhookPayload } from "../../../src/utils/webhookAlpacaOrders.ts";
import { decodeWebhookBody, parseOptionMessage, isOptionMessagePayload } from "../../../src/utils/optionWebhook.ts";
import { runOptionPlanBatch } from "./option_plan_worker.ts";
import { storeOptionPlan, OptionPlanConflict } from './option_plan_store.ts';
import { handleOptionTicketRoute } from './option_ticket_routes.ts';
import { handleWebhookManagement } from './webhook_management.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret, x-webhook-id",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function getBrokerBaseUrl(broker: any) {
  return broker?.base_url || broker?.baseUrl || "https://paper-api.alpaca.markets";
}

async function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      supabase: null,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  return {
    supabase: createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    }),
    error: null,
  };
}

async function getAuthenticatedUserId(req: Request, supabase: any) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return { userId: null, error: "Missing bearer token" };
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user?.id) {
    return { userId: null, error: error?.message ?? "Invalid bearer token" };
  }

  return { userId: data.user.id, error: null };
}

async function getAlpacaCredentialRows(supabase: any, userId: string, brokerAccountId?: string | null) {
  let query = supabase
    .from("broker_credentials")
    .select("api_key, api_secret, broker_account_id")
    .eq("user_id", userId);

  if (brokerAccountId) {
    query = query.eq("broker_account_id", brokerAccountId).limit(1);
  } else {
    query = query.limit(20);
  }

  const { data } = await query;
  return Array.isArray(data) ? data : [];
}

async function getAlpacaHeaders(supabase: any, userId: string, brokerAccountId?: string | null) {
  const credentialRows = await getAlpacaCredentialRows(supabase, userId, brokerAccountId);

  const credential = Array.isArray(credentialRows)
    ? credentialRows.find((row: any) => row.api_key && row.api_secret)
    : null;

  if (credential) {
    return {
      headers: {
        "APCA-API-KEY-ID": credential.api_key,
        "APCA-API-SECRET-KEY": credential.api_secret,
      },
      error: null,
    };
  }

  const envKey = Deno.env.get("ALPACA_API_KEY") ?? Deno.env.get("APCA_API_KEY_ID");
  const envSecret = Deno.env.get("ALPACA_API_SECRET") ?? Deno.env.get("APCA_API_SECRET_KEY");

  if (envKey && envSecret) {
    return {
      headers: {
        "APCA-API-KEY-ID": envKey,
        "APCA-API-SECRET-KEY": envSecret,
      },
      error: null,
    };
  }

  const { data: kvRows } = await supabase
    .from("kv_store_f118884a")
    .select("value")
    .like("key", `user:${userId}:broker:%`);

  const broker = Array.isArray(kvRows)
    ? kvRows
        .map((row: any) => row.value)
        .find((value: any) =>
          value?.connected &&
          value?.apiKey &&
          value?.apiSecret &&
          String(value?.brokerType || value?.id || "").toLowerCase().includes("alpaca")
        )
    : null;

  if (broker) {
    return {
      headers: {
        "APCA-API-KEY-ID": broker.apiKey,
        "APCA-API-SECRET-KEY": broker.apiSecret,
      },
      error: null,
    };
  }

  return {
    headers: null,
    error: "No Alpaca credentials found. Connect an Alpaca broker account first.",
  };
}

async function proxyAlpacaJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: data ?? { error: "Alpaca request failed" },
    };
  }

  return {
    ok: true,
    status: response.status,
    data,
  };
}

async function submitAlpacaOrder(
  broker: any,
  headers: Record<string, string>,
  order: Record<string, any>,
) {
  const response = await fetch(`${getBrokerBaseUrl(broker)}/v2/orders`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(order),
  });
  const data = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    request: order,
    response: data,
  };
}

async function getKvValue(supabase: any, key: string) {
  const { data, error } = await supabase
    .from("kv_store_f118884a")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  return { value: data?.value ?? null, error: error?.message ?? null };
}

async function setKvValue(supabase: any, key: string, value: unknown) {
  const { error } = await supabase
    .from("kv_store_f118884a")
    .upsert({ key, value }, { onConflict: "key" });

  return error?.message ?? null;
}

async function deleteKvValue(supabase: any, key: string) {
  const { error } = await supabase
    .from("kv_store_f118884a")
    .delete()
    .eq("key", key);

  return error?.message ?? null;
}

async function listKvPrefix(supabase: any, prefix: string) {
  const { data, error } = await supabase
    .from("kv_store_f118884a")
    .select("key, value, updated_at")
    .like("key", `${prefix}%`)
    .order("updated_at", { ascending: false });

  return {
    rows: Array.isArray(data) ? data : [],
    error: error?.message ?? null,
  };
}

async function readJson(req: Request) {
  return req.json().catch(() => ({}));
}

function collectRequestHeaders(req: Request) {
  const allowedHeaders = [
    "content-type",
    "user-agent",
    "x-client-info",
    "x-forwarded-for",
    "x-real-ip",
    "x-webhook-secret",
  ];

  return allowedHeaders.reduce((headers: Record<string, string>, name) => {
    const value = req.headers.get(name);
    if (value) headers[name] = name === "x-webhook-secret" ? "[provided]" : value;
    return headers;
  }, {});
}

async function insertWebhookOrderRequestLog(
  supabase: any,
  input: {
    req: Request;
    url: URL;
    token?: string | null;
    route?: any;
    payload?: unknown;
    status: string;
    httpStatus: number;
    error?: string | null;
    response?: unknown;
  },
) {
  const legacyStrategyId = extractLegacyTradingViewStrategyId(input.url.pathname);
  const { data, error } = await supabase
    .from("webhook_order_request_logs")
    .insert({
      method: input.req.method,
      path: input.url.pathname,
      query: Object.fromEntries(input.url.searchParams.entries()),
      token: input.token ?? null,
      route_id: input.route?.id ?? null,
      user_id: input.route?.user_id ?? null,
      strategy_id: input.route?.strategy_id ?? legacyStrategyId ?? null,
      broker_account_id: input.route?.broker_account_id ?? null,
      source: input.payload && typeof input.payload === "object"
        ? (input.payload as any).source ?? null
        : null,
      symbol: input.payload && typeof input.payload === "object"
        ? (input.payload as any).symbol ?? null
        : null,
      side: input.payload && typeof input.payload === "object"
        ? (input.payload as any).side ?? (input.payload as any).action ?? null
        : null,
      status: input.status,
      http_status: input.httpStatus,
      error_message: input.error ?? null,
      request_headers: collectRequestHeaders(input.req),
      request_payload: input.payload ?? {},
      response_payload: input.response ?? {},
    })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("webhook_order_request_logs insert failed:", error);
    return null;
  }

  return data ?? null;
}

async function updateWebhookOrderRequestLog(
  supabase: any,
  logId: string | null | undefined,
  input: {
    status: string;
    httpStatus: number;
    error?: string | null;
    response?: unknown;
    route?: any;
  },
) {
  if (!logId) return;

  const updates: Record<string, any> = {
    status: input.status,
    http_status: input.httpStatus,
    error_message: input.error ?? null,
    response_payload: input.response ?? {},
    updated_at: new Date().toISOString(),
  };

  if (input.route) {
    updates.route_id = input.route?.id ?? null;
    updates.user_id = input.route?.user_id ?? null;
    updates.strategy_id = input.route?.strategy_id ?? null;
    updates.broker_account_id = input.route?.broker_account_id ?? null;
  }

  const { error } = await supabase
    .from("webhook_order_request_logs")
    .update(updates)
    .eq("id", logId);

  if (error) {
    console.error("webhook_order_request_logs update failed:", error);
  }
}

async function getPrimaryBrokerAccount(supabase: any, userId: string, brokerAccountId?: string | null) {
  let query = supabase
    .from("broker_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("broker_type", "alpaca")
    .eq("connected", true);

  if (brokerAccountId) {
    query = query.eq("id", brokerAccountId);
  } else {
    query = query.order("created_at", { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return { broker: null, error: error?.message || "No connected Alpaca broker account found" };
  }

  return { broker: data, error: null };
}

async function getRiskSettings(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("risk_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return {};
  }

  return {
    killSwitchEnabled: Boolean(data.kill_switch_enabled),
    authorizedUserIds: Array.isArray(data.authorized_user_ids) ? data.authorized_user_ids : null,
  };
}

async function fetchAlpacaBrokerSnapshot(supabase: any, userId: string, brokerAccountId?: string | null) {
  const [{ broker }, { headers, error: credentialsError }] = await Promise.all([
    getPrimaryBrokerAccount(supabase, userId, brokerAccountId),
    getAlpacaHeaders(supabase, userId, brokerAccountId),
  ]);

  if (credentialsError || !headers) {
    return {
      snapshot: null,
      error: credentialsError || "No Alpaca credentials found. Connect an Alpaca broker account first.",
    };
  }

  const baseUrl = getBrokerBaseUrl(broker);
  const [account, positions, orders] = await Promise.all([
    proxyAlpacaJson(`${baseUrl}/v2/account`, headers),
    proxyAlpacaJson(`${baseUrl}/v2/positions`, headers),
    proxyAlpacaJson(`${baseUrl}/v2/orders?status=all&limit=500&direction=desc`, headers),
  ]);

  if (!account.ok) {
    return { snapshot: null, error: account.data?.message || account.data?.error || "Failed to load Alpaca account" };
  }

  const connection = {
    ...(broker || {
      id: brokerAccountId || "alpaca:env",
      broker_type: "alpaca",
      name: "Alpaca",
      connected: true,
      paper: true,
    }),
    brokerType: broker?.broker_type || broker?.brokerType || "alpaca",
    connected: true,
  };

  return {
    snapshot: normalizeBrokerSnapshot({
      connection,
      account: account.data || {},
      positions: Array.isArray(positions.data) ? positions.data : [],
      orders: Array.isArray(orders.data) ? orders.data : [],
    }),
    error: null,
  };
}

async function listBrokerAccounts(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("broker_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return { brokers: null, error: error.message };
  }

  const credentialRows = await getAlpacaCredentialRows(supabase, userId);
  return {
    brokers: dedupeBrokerAccounts(data ?? [], credentialRows),
    error: null,
  };
}

async function deleteBrokerAccountIds(supabase: any, userId: string, brokerAccountIds: string[]) {
  const ids = brokerAccountIds.filter(Boolean);
  if (ids.length === 0) return null;

  await supabase
    .from("broker_credentials")
    .delete()
    .eq("user_id", userId)
    .in("broker_account_id", ids);

  const { error } = await supabase
    .from("broker_accounts")
    .delete()
    .eq("user_id", userId)
    .in("id", ids);

  return error?.message ?? null;
}

async function cleanupDuplicateBrokerAccounts(
  supabase: any,
  userId: string,
  input: {
    canonicalBrokerAccountId: string;
    brokerType: string;
    accountNumber?: string | null;
    apiKey?: string | null;
    apiSecret?: string | null;
  },
) {
  const [brokerRows, credentialRows] = await Promise.all([
    supabase
      .from("broker_accounts")
      .select("id, broker_type, account_id, metadata, created_at, updated_at")
      .eq("user_id", userId),
    supabase
      .from("broker_credentials")
      .select("broker_account_id, api_key, api_secret")
      .eq("user_id", userId),
  ]);

  const conflictingIds = findConflictingBrokerAccountIds({
    brokers: brokerRows.data ?? [],
    credentials: credentialRows.data ?? [],
    ...input,
  });

  return deleteBrokerAccountIds(supabase, userId, conflictingIds);
}

async function upsertBrokerConnection(supabase: any, userId: string, payload: any) {
  const { brokerType, name, apiKey, apiSecret, paper } = normalizeBrokerConnectPayload(payload);

  if (brokerType === "alpaca") {
    const baseUrl = paper
      ? "https://paper-api.alpaca.markets"
      : "https://api.alpaca.markets";

    const accountResponse = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
      },
    });

    if (!accountResponse.ok) {
      const errorData = await accountResponse.json().catch(() => ({}));
      return {
        broker: null,
        error:
          errorData?.message ||
          errorData?.error ||
          "Invalid Alpaca credentials",
        status: 400,
      };
    }

    const accountData = await accountResponse.json();
    const brokerAccountId = `${brokerType}:${accountData.account_number}`;
    const metadata = {
      account: accountData,
    };
    const duplicateCleanupError = await cleanupDuplicateBrokerAccounts(supabase, userId, {
      canonicalBrokerAccountId: brokerAccountId,
      brokerType,
      accountNumber: accountData.account_number,
      apiKey,
      apiSecret,
    });

    if (duplicateCleanupError) {
      return { broker: null, error: duplicateCleanupError, status: 500 };
    }

    const { data: brokerRow, error: brokerError } = await supabase
      .from("broker_accounts")
      .upsert({
        id: brokerAccountId,
        user_id: userId,
        broker_type: brokerType,
        name,
        account_id: accountData.account_number,
        connected: true,
        paper,
        base_url: baseUrl,
        metadata,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (brokerError) {
      return { broker: null, error: brokerError.message, status: 500 };
    }

    await supabase
      .from("broker_credentials")
      .delete()
      .eq("user_id", userId)
      .eq("broker_account_id", brokerAccountId);

    const { error: credentialError } = await supabase
      .from("broker_credentials")
      .insert({
        broker_account_id: brokerAccountId,
        user_id: userId,
        api_key: apiKey,
        api_secret: apiSecret,
        updated_at: new Date().toISOString(),
      });

    if (credentialError) {
      return { broker: null, error: credentialError.message, status: 500 };
    }

    return { broker: brokerRow, error: null, status: 200 };
  }

  const brokerAccountId = `${brokerType}:${Date.now()}`;
  const { data: brokerRow, error: brokerError } = await supabase
    .from("broker_accounts")
    .insert({
      id: brokerAccountId,
      user_id: userId,
      broker_type: brokerType,
      name,
      account_id: brokerAccountId,
      connected: true,
      paper,
      base_url: null,
      metadata: { placeholder: true },
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (brokerError) {
    return { broker: null, error: brokerError.message, status: 500 };
  }

  const { error: credentialError } = await supabase
    .from("broker_credentials")
    .insert({
      broker_account_id: brokerAccountId,
      user_id: userId,
      api_key: apiKey,
      api_secret: apiSecret,
      updated_at: new Date().toISOString(),
    });

  if (credentialError) {
    return { broker: null, error: credentialError.message, status: 500 };
  }

  return { broker: brokerRow, error: null, status: 200 };
}

async function getBrokerAccountAndHeaders(supabase: any, userId: string, brokerAccountId?: string | null) {
  const [{ broker, error: brokerError }, { headers, error: headersError }] = await Promise.all([
    getPrimaryBrokerAccount(supabase, userId, brokerAccountId),
    getAlpacaHeaders(supabase, userId, brokerAccountId),
  ]);

  return {
    broker,
    headers,
    error: brokerError || headersError,
  };
}

async function handleAlpacaReadRoute(req: Request, url: URL, supabase: any, userId: string) {
  const path = url.pathname;
  const brokerAccountId = url.searchParams.get("brokerId");

  if (path.endsWith("/alpaca/account") && req.method === "GET") {
    const { broker, headers, error } = await getBrokerAccountAndHeaders(supabase, userId, brokerAccountId);
    if (error || !headers) {
      return jsonResponse({ error: error || "Alpaca not connected" }, 404);
    }

    const response = await proxyAlpacaJson(`${getBrokerBaseUrl(broker)}/v2/account`, headers);
    return response.ok
      ? jsonResponse(response.data)
      : jsonResponse(response.data ?? { error: "Failed to fetch Alpaca account" }, response.status || 400);
  }

  if (path.endsWith("/alpaca/positions") && req.method === "GET") {
    const { broker, headers, error } = await getBrokerAccountAndHeaders(supabase, userId, brokerAccountId);
    if (error || !headers) {
      return jsonResponse({ error: error || "Alpaca not connected" }, 404);
    }

    const response = await proxyAlpacaJson(`${getBrokerBaseUrl(broker)}/v2/positions`, headers);
    return response.ok ? jsonResponse(Array.isArray(response.data) ? response.data : []) : jsonResponse([]);
  }

  if (path.endsWith("/alpaca/orders") && req.method === "GET") {
    const { broker, headers, error } = await getBrokerAccountAndHeaders(supabase, userId, brokerAccountId);
    if (error || !headers) {
      return jsonResponse({ error: error || "Alpaca not connected" }, 404);
    }

    const status = url.searchParams.get("status") || "closed";
    const limit = url.searchParams.get("limit") || "500";
    const response = await proxyAlpacaJson(
      `${getBrokerBaseUrl(broker)}/v2/orders?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}&direction=desc`,
      headers,
    );
    return response.ok ? jsonResponse(Array.isArray(response.data) ? response.data : []) : jsonResponse([]);
  }

  if (path.endsWith("/alpaca/portfolio-history") && req.method === "GET") {
    const { broker, headers, error } = await getBrokerAccountAndHeaders(supabase, userId, brokerAccountId);
    if (error || !headers) {
      return jsonResponse({ error: error || "Alpaca not connected" }, 404);
    }

    const timeframe = url.searchParams.get("timeframe") || "1D";
    const period = url.searchParams.get("period") || "1M";
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("start_date");
    const endDate = url.searchParams.get("endDate") || url.searchParams.get("end_date");
    const alpacaUrl = new URL(`${getBrokerBaseUrl(broker)}/v2/account/portfolio/history`);
    alpacaUrl.searchParams.set("timeframe", timeframe);

    if (startDate && endDate) {
      alpacaUrl.searchParams.set("start", startDate);
      alpacaUrl.searchParams.set("end", endDate);
    } else {
      alpacaUrl.searchParams.set("period", period);
    }

    const response = await proxyAlpacaJson(alpacaUrl.toString(), headers);
    return response.ok
      ? jsonResponse(response.data ?? {})
      : jsonResponse(response.data ?? { error: "Failed to fetch portfolio history" }, response.status || 400);
  }

  return null;
}

async function handleLegacyStrategyRoutes(req: Request, url: URL, supabase: any, userId: string) {
  const path = url.pathname;

  if (path.endsWith("/strategies") && req.method === "GET") {
    const { rows, error } = await listKvPrefix(supabase, `user:${userId}:strategy:`);
    if (error) {
      return jsonResponse({ error: "Failed to fetch strategies", details: error }, 500);
    }

    return jsonResponse(rows.map((row: any) => row.value ?? {}).filter(Boolean));
  }

  if (path.endsWith("/strategies") && req.method === "POST") {
    const strategy = await readJson(req);
    const strategyId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    let webhookToken = strategy.webhookToken ?? strategy.webhook_token ?? null;
    let webhookUrl = strategy.webhookUrl ?? strategy.webhook_url ?? null;

    if ((strategy.strategyType ?? strategy.strategy_type) === "tradingview") {
      webhookToken = webhookToken || crypto.randomUUID();
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      webhookUrl = buildLegacyStrategyWebhookUrl(supabaseUrl, strategyId, webhookToken);
    }

    const storedStrategy = {
      ...strategy,
      id: strategyId,
      userId,
      webhookToken,
      webhookUrl,
      createdAt,
      updatedAt: createdAt,
    };

    const error = await setKvValue(supabase, buildLegacyStrategyKey(userId, strategyId), storedStrategy);
    return error
      ? jsonResponse({ error: "Failed to create strategy", details: error }, 500)
      : jsonResponse({ success: true, strategyId, webhookUrl, strategy: storedStrategy }, 201);
  }

  if (path.endsWith("/strategies/clear-risk-settings") && req.method === "POST") {
    const { rows, error } = await listKvPrefix(supabase, `user:${userId}:strategy:`);
    if (error) {
      return jsonResponse({ error: "Failed to clear risk settings", details: error }, 500);
    }

    let updatedCount = 0;
    for (const row of rows) {
      const strategy = row?.value ?? {};
      const key = row?.key;
      if (!key) continue;

      const updatedStrategy = {
        ...strategy,
        maxPositions: null,
        maxDailyLoss: null,
        tradingHoursStart: null,
        tradingHoursEnd: null,
        symbols: "",
        updatedAt: new Date().toISOString(),
      };
      const saveError = await setKvValue(supabase, key, updatedStrategy);
      if (!saveError) updatedCount += 1;
    }

    return jsonResponse({
      success: true,
      message: `Risk settings cleared for ${updatedCount} strategies`,
      updatedCount,
    });
  }

  const strategyBacktestMatch = path.match(/\/strategies\/([^/]+)\/backtests$/);
  if (strategyBacktestMatch && req.method === "GET") {
    const strategyId = strategyBacktestMatch[1];
    const { rows, error } = await listKvPrefix(supabase, `user:${userId}:backtest:`);
    if (error) {
      return jsonResponse({ error: "Failed to fetch backtests", details: error }, 500);
    }

    const backtests = rows
      .map((row: any) => row.value ?? {})
      .filter((item: any) => item?.strategyId === strategyId);
    return jsonResponse(backtests);
  }

  const strategyTradesMatch = path.match(/\/strategies\/([^/]+)\/trades$/);
  if (strategyTradesMatch && req.method === "GET") {
    const strategyId = strategyTradesMatch[1];
    const { rows, error } = await listKvPrefix(supabase, buildLegacyTradePrefix(userId));
    if (error) {
      return jsonResponse({ error: "Failed to fetch strategy trades", details: error }, 500);
    }

    const trades = rows
      .map((row: any) => row.value ?? {})
      .filter((item: any) => item?.strategyId === strategyId);
    return jsonResponse(trades);
  }

  const strategySyncMatch = path.match(/\/strategies\/([^/]+)\/sync-trades$/);
  if (strategySyncMatch && req.method === "POST") {
    return jsonResponse({
      success: true,
      updatedCount: 0,
      deletedCount: 0,
      message: "Legacy strategy trade sync is currently a no-op on the Supabase backend.",
    });
  }

  const strategyBacktestRunMatch = path.match(/\/strategies\/([^/]+)\/backtest$/);
  if (strategyBacktestRunMatch && req.method === "POST") {
    const strategyId = strategyBacktestRunMatch[1];
    const { value: strategy, error: strategyError } = await getKvValue(
      supabase,
      buildLegacyStrategyKey(userId, strategyId),
    );

    if (strategyError || !strategy) {
      return jsonResponse({ error: strategyError || "Strategy not found" }, 404);
    }

    const body = await readJson(req);
    const backtestId = crypto.randomUUID();
    const initialCapital = Number(body.initialCapital ?? 100000);
    const storedBacktest = {
      id: backtestId,
      strategyId,
      strategyName: strategy.name,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      initialCapital,
      results: {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalReturn: 0,
        finalEquity: initialCapital,
        initialCapital,
        netProfit: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        equityCurve: [],
      },
      createdAt: new Date().toISOString(),
    };

    const error = await setKvValue(supabase, buildLegacyBacktestKey(userId, backtestId), storedBacktest);
    return error
      ? jsonResponse({ error: "Failed to run backtest", details: error }, 500)
      : jsonResponse({ success: true, backtestId, results: storedBacktest.results });
  }

  const strategyMatch = path.match(/\/strategies\/([^/]+)$/);
  if (strategyMatch && req.method === "PUT") {
    const strategyId = strategyMatch[1];
    const key = buildLegacyStrategyKey(userId, strategyId);
    const { value: existing, error: existingError } = await getKvValue(supabase, key);
    if (existingError || !existing) {
      return jsonResponse({ error: existingError || "Strategy not found" }, 404);
    }

    const updates = await readJson(req);
    let updatedStrategy = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (
      (updates.strategyType ?? updates.strategy_type) === "tradingview" &&
      !updatedStrategy.webhookToken
    ) {
      const webhookToken = crypto.randomUUID();
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      updatedStrategy = {
        ...updatedStrategy,
        webhookToken,
        webhookUrl: buildLegacyStrategyWebhookUrl(supabaseUrl, strategyId, webhookToken),
      };
    }

    const error = await setKvValue(supabase, key, updatedStrategy);
    return error
      ? jsonResponse({ error: "Failed to update strategy", details: error }, 500)
      : jsonResponse({ success: true, strategy: updatedStrategy });
  }

  if (strategyMatch && req.method === "DELETE") {
    const strategyId = strategyMatch[1];
    const error = await deleteKvValue(supabase, buildLegacyStrategyKey(userId, strategyId));
    return error
      ? jsonResponse({ error: "Failed to delete strategy", details: error }, 500)
      : jsonResponse({ success: true });
  }

  return null;
}

async function findLegacyTradingViewStrategy(supabase: any, strategyId: string, token: string) {
  const { rows, error } = await listKvPrefix(supabase, "user:");
  if (error) return { strategy: null, userId: null, error };

  const strategyRow = rows.find((row: any) => {
    const key = String(row?.key ?? "");
    const value = row?.value ?? {};
    return key.endsWith(`:strategy:${strategyId}`) && value?.webhookToken === token;
  });

  if (!strategyRow) {
    return { strategy: null, userId: null, error: null };
  }

  const keyMatch = String(strategyRow.key ?? "").match(/^user:(.+):strategy:/);
  return {
    strategy: strategyRow.value ?? null,
    userId: keyMatch?.[1] ?? strategyRow.value?.userId ?? null,
    error: null,
  };
}

async function persistLegacyTradingViewTrade(
  supabase: any,
  userId: string,
  strategyId: string,
  payload: Record<string, any>,
  brokerResult?: {
    broker?: any;
    alpaca?: any;
    order?: Record<string, any>;
  },
) {
  const tradeId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const alpacaResponse = brokerResult?.alpaca?.response ?? null;
  const trade = {
    id: tradeId,
    strategyId,
    symbol: payload.symbol ?? null,
    side: payload.side ?? payload.action ?? null,
    qty: payload.quantity ?? payload.qty ?? null,
    type: brokerResult?.order?.type ?? payload.order_type ?? payload.orderType ?? payload.type ?? "market",
    limitPrice: brokerResult?.order?.limit_price ?? payload.limit_price ?? payload.limitPrice ?? null,
    status: brokerResult?.alpaca
      ? (brokerResult.alpaca.ok ? (alpacaResponse?.status ?? "submitted") : "rejected")
      : "received",
    source: payload.source ?? "tradingview",
    submittedAt: createdAt,
    filledAt: alpacaResponse?.filled_at ?? null,
    broker: brokerResult?.alpaca ? "alpaca" : null,
    brokerId: brokerResult?.broker?.id ?? null,
    brokerAccountId: brokerResult?.broker?.account_id ?? brokerResult?.broker?.accountId ?? null,
    brokerOrderId: alpacaResponse?.id ?? null,
    brokerResponse: alpacaResponse,
    brokerRequest: brokerResult?.alpaca?.request ?? null,
    rawPayload: payload,
  };

  const error = await setKvValue(supabase, `${buildLegacyTradePrefix(userId)}${tradeId}`, trade);
  return { trade, error };
}

function runWebhookBackgroundTask(task: () => Promise<void>) {
  const promise = task().catch((error) => {
    console.error("webhook background processing failed:", error);
  });
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(promise);
  } else {
    void promise;
  }
}

async function receiveOptionMessage(req: Request, supabase: any, payload: any, token: string, legacyStrategyId: string | null, requestLogId?: string) {
  try {
    let userId: string;
    let brokerId: string | null = null;
    let strategyId: string | null = legacyStrategyId;
    let scope: string;
    let logRoute: any;
    if (legacyStrategyId) {
      const legacy = await findLegacyTradingViewStrategy(supabase, legacyStrategyId, token);
      if (legacy.error) return jsonResponse({ error: 'Strategy lookup failed' }, 500);
      if (!legacy.strategy || !legacy.userId) return jsonResponse({ error: 'No active strategy found' }, 404);
      userId = legacy.userId;
      scope = `legacy:${userId}:${legacyStrategyId}`;
      logRoute = { user_id: userId, strategy_id: legacyStrategyId };
    } else {
      const { data: route, error } = await supabase.from('webhook_routes').select('*').eq('token', token).eq('status', 'active').maybeSingle();
      if (error) return jsonResponse({ error: 'Route lookup failed' }, 500);
      if (!route?.user_id) return jsonResponse({ error: 'No active route found' }, 404);
      userId = route.user_id;
      brokerId = route.broker_account_id;
      strategyId = route.strategy_id;
      scope = `route:${route.id}`;
      logRoute = route;
    }
    await updateWebhookOrderRequestLog(supabase, requestLogId, { status: 'option_route_matched', httpStatus: 202, route: logRoute });
    // No order can be accepted until the persistent worker has been configured.
    if (!Deno.env.get('OPTION_WORKER_SECRET')) return jsonResponse({ error: 'Option worker is not configured' }, 503);
    const ready = await supabase.rpc('option_worker_ready', {
      expected_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-listener/internal/options/reconcile`,
      expected_secret: Deno.env.get('OPTION_WORKER_SECRET'),
    });
    if (ready.error || ready.data !== true) return jsonResponse({ error: 'Option reconciliation schedule is not configured' }, 503);
    const parsed = parseOptionMessage(payload.message);
    // A mixed stock/option payload must never silently override either instruction.
    const conflicting = ['symbol', 'side', 'action', 'qty', 'quantity', 'type', 'order_type', 'orderType',
      'limit_price', 'limitPrice', 'price', 'time_in_force', 'timeInForce', 'position_intent'];
    if (conflicting.some(key => payload[key] !== undefined)) return jsonResponse({ error: 'Option messages cannot include separate order fields' }, 400);
    const connection = await getBrokerAccountAndHeaders(supabase, userId, brokerId);
    if (connection.error || !connection.broker) return jsonResponse({ error: connection.error || 'Broker not connected' }, 409);
    const { plan, duplicate } = await storeOptionPlan(supabase, {
      parsed, userId, brokerId: connection.broker.id, baseUrl: getBrokerBaseUrl(connection.broker), scope,
      strategyId, message: payload.message, eventId: payload.event_id ?? req.headers.get('x-webhook-id') ?? undefined,
    });
    runWebhookBackgroundTask(async () => { await runOptionPlanBatch(supabase, getBrokerAccountAndHeaders, plan.id); });
    return jsonResponse({ ok: true, duplicate, plan_id: plan.id, status: plan.status, symbol: plan.symbol,
      message: 'Option plan stored; broker submission and first-target execution are tracked asynchronously.' }, 202);
  } catch (error: any) {
    return jsonResponse({ error: error?.message || 'Unable to accept option message' },
      error instanceof OptionPlanConflict ? 409 : /Expected|Invalid expiration|Strike and entry|Option message|event_id/.test(error?.message || '') ? 400 : 500);
  }
}

async function processLegacyTradingViewOrder(input: {
  supabase: any;
  requestLogId?: string | null;
  legacyStrategyId: string;
  token: string;
  payload: Record<string, any>;
  alpacaOrder: Record<string, any>;
}) {
  const { supabase, requestLogId, legacyStrategyId, token, payload, alpacaOrder } = input;
  const legacy = await findLegacyTradingViewStrategy(supabase, legacyStrategyId, token);

  if (legacy.error) {
    const response = { error: "Legacy strategy lookup failed", details: legacy.error };
    await updateWebhookOrderRequestLog(supabase, requestLogId, {
      status: "legacy_lookup_failed",
      httpStatus: 500,
      error: response.error,
      response,
    });
    return;
  }

  if (!legacy.strategy || !legacy.userId) {
    const response = { error: "No active legacy TradingView strategy found", token, strategyId: legacyStrategyId };
    await updateWebhookOrderRequestLog(supabase, requestLogId, {
      status: "legacy_strategy_not_found",
      httpStatus: 404,
      error: response.error,
      response,
    });
    return;
  }

  const route = {
    user_id: legacy.userId,
    strategy_id: legacyStrategyId,
  };

  const { broker, headers, error: brokerError } = await getBrokerAccountAndHeaders(supabase, legacy.userId);
  if (brokerError || !headers) {
    const { trade, error } = await persistLegacyTradingViewTrade(supabase, legacy.userId, legacyStrategyId, payload);
    const response = {
      error: brokerError || "Alpaca broker credentials not found",
      matched_strategy: {
        id: legacyStrategyId,
        name: legacy.strategy.name ?? null,
        user_id: legacy.userId,
      },
      trade,
    };
    await updateWebhookOrderRequestLog(supabase, requestLogId, {
      status: error ? "legacy_trade_log_failed" : "broker_credentials_missing",
      httpStatus: error ? 500 : 404,
      error: error ? "Failed to log legacy TradingView trade" : response.error,
      response: error ? { ...response, details: error } : response,
      route,
    });
    return;
  }

  const alpaca = await submitAlpacaOrder(broker, headers, alpacaOrder);
  const { trade, error } = await persistLegacyTradingViewTrade(
    supabase,
    legacy.userId,
    legacyStrategyId,
    payload,
    { broker, alpaca, order: alpacaOrder },
  );

  if (error) {
    const response = { error: "Failed to log legacy TradingView trade", details: error };
    await updateWebhookOrderRequestLog(supabase, requestLogId, {
      status: "legacy_trade_log_failed",
      httpStatus: 500,
      error: response.error,
      response,
      route,
    });
    return;
  }

  const response = {
    ok: alpaca.ok,
    matched_strategy: {
      id: legacyStrategyId,
      name: legacy.strategy.name ?? null,
      user_id: legacy.userId,
    },
    trade,
    alpaca: {
      ok: alpaca.ok,
      status: alpaca.status,
      request: alpaca.request,
      response: alpaca.response,
    },
    message: alpaca.ok
      ? "TradingView webhook received and submitted to Alpaca."
      : "TradingView webhook received, but Alpaca rejected the order.",
  };
  await updateWebhookOrderRequestLog(supabase, requestLogId, {
    status: alpaca.ok ? "submitted" : "alpaca_rejected",
    httpStatus: alpaca.ok ? 200 : 502,
    error: alpaca.ok ? null : alpaca.response?.message ?? alpaca.response?.error ?? "Alpaca order rejected",
    response,
    route,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  if (path.endsWith('/webhook-listener/internal/options/reconcile')) {
    const secret = Deno.env.get('OPTION_WORKER_SECRET');
    if (!secret || req.headers.get('x-option-worker-secret') !== secret) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const { supabase, error } = await getSupabaseClient();
    if (!supabase) return jsonResponse({ error }, 503);
    try { return jsonResponse({ results: await runOptionPlanBatch(supabase, getBrokerAccountAndHeaders) }); }
    catch (error: any) { return jsonResponse({ error: error.message }, 500); }
  }

  const strategyLabResponse = await handleStrategyLabRoutes(req, path, jsonResponse);
  if (strategyLabResponse) {
    return strategyLabResponse;
  }

  if (/\/webhooks(?:\/[^/]+(?:\/(?:events|preview))?)?$/.test(path)) {
    const { supabase, error } = await getSupabaseClient();
    if (!supabase) return jsonResponse({ error }, 503);
    const { userId, error: authError } = await getAuthenticatedUserId(req, supabase);
    if (!userId || authError) return jsonResponse({ error: authError || 'Unauthorized' }, 401);
    const result = await handleWebhookManagement(req, url, { supabase, userId,
      baseUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-listener`, getBroker: getBrokerAccountAndHeaders });
    return jsonResponse(result.body, result.status);
  }

  if (path.endsWith('/option-plans') || path.endsWith('/option-plans/preview')) {
    const { supabase, error } = await getSupabaseClient();
    if (!supabase) return jsonResponse({ error }, 503);
    const { userId, error: authError } = await getAuthenticatedUserId(req, supabase);
    if (!userId || authError) return jsonResponse({ error: authError || 'Unauthorized' }, 401);
    const result = await handleOptionTicketRoute(req, url, {
      supabase, userId, getBroker: getBrokerAccountAndHeaders,
      workerReady: async () => {
        if (!Deno.env.get('OPTION_WORKER_SECRET')) return false;
        const result = await supabase.rpc('option_worker_ready', {
          expected_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-listener/internal/options/reconcile`,
          expected_secret: Deno.env.get('OPTION_WORKER_SECRET'),
        });
        return !result.error && result.data === true;
      },
      enqueue: (id) => runWebhookBackgroundTask(async () => { await runOptionPlanBatch(supabase, getBrokerAccountAndHeaders, id); }),
    });
    return jsonResponse(result.body, result.status);
  }

  if (
    path.endsWith("/brokers") ||
    path.match(/\/brokers\/[^/]+$/)
  ) {
    const { supabase, error: clientError } = await getSupabaseClient();

    if (clientError || !supabase) {
      return jsonResponse({ error: clientError }, 500);
    }

    const { userId, error: authError } = await getAuthenticatedUserId(req, supabase);

    if (authError || !userId) {
      return jsonResponse({ error: authError }, 401);
    }

    if (path.endsWith("/brokers") && req.method === "GET") {
      const { brokers, error } = await listBrokerAccounts(supabase, userId);
      return error
        ? jsonResponse({ error: "Failed to fetch brokers", details: error }, 500)
        : jsonResponse(brokers);
    }

    if (path.endsWith("/brokers") && req.method === "POST") {
      const body = await readJson(req);
      try {
        const { broker, error, status } = await upsertBrokerConnection(supabase, userId, body);
        return error
          ? jsonResponse({ error }, status || 400)
          : jsonResponse({ success: true, broker });
      } catch (error: any) {
        return jsonResponse({ error: error?.message || "Failed to connect broker" }, 400);
      }
    }

    const brokerMatch = path.match(/\/brokers\/([^/]+)$/);
    if (brokerMatch && req.method === "DELETE") {
      const brokerId = decodeURIComponent(brokerMatch[1]);
      const error = await deleteBrokerAccountIds(supabase, userId, [brokerId]);

      return error
        ? jsonResponse({ error: "Failed to disconnect broker", details: error }, 500)
        : jsonResponse({ success: true });
    }
  }

  if (
    path.endsWith("/strategies") ||
    path.endsWith("/strategies/clear-risk-settings") ||
    path.match(/\/strategies\/[^/]+$/) ||
    path.match(/\/strategies\/[^/]+\/backtest$/) ||
    path.match(/\/strategies\/[^/]+\/backtests$/) ||
    path.match(/\/strategies\/[^/]+\/trades$/) ||
    path.match(/\/strategies\/[^/]+\/sync-trades$/) ||
    path.endsWith("/alpaca/account") ||
    path.endsWith("/alpaca/positions") ||
    path.endsWith("/alpaca/orders") ||
    path.endsWith("/alpaca/portfolio-history") ||
    path.endsWith("/platform-orders/route") ||
    path.match(/\/platform-orders\/[^/]+\/reconcile$/) ||
    path.endsWith("/strategy-automation/schedules") ||
    path.match(/\/strategy-automation\/schedules\/[^/]+$/) ||
    path.endsWith("/strategy-automation/run") ||
    path.endsWith("/alpaca/options/contracts") ||
    path.match(/\/alpaca\/options\/chain\/[^/]+$/)
  ) {
    const { supabase, error: clientError } = await getSupabaseClient();

    if (clientError || !supabase) {
      return jsonResponse({ error: clientError }, 500);
    }

    const { userId, error: authError } = await getAuthenticatedUserId(req, supabase);

    if (authError || !userId) {
      return jsonResponse({ error: authError }, 401);
    }

    const legacyStrategyRouteResponse = await handleLegacyStrategyRoutes(req, url, supabase, userId);
    if (legacyStrategyRouteResponse) {
      return legacyStrategyRouteResponse;
    }

    const alpacaRouteResponse = await handleAlpacaReadRoute(req, url, supabase, userId);
    if (alpacaRouteResponse) {
      return alpacaRouteResponse;
    }

    if (path.endsWith("/alpaca/options/contracts") && req.method === "GET") {
      const { broker, headers, error: credentialsError } = await getBrokerAccountAndHeaders(supabase, userId, url.searchParams.get('brokerId'));

      if (credentialsError || !headers) {
        return jsonResponse({ error: credentialsError }, 404);
      }

      const params = new URLSearchParams(url.search);
      params.delete('brokerId');
      if (!params.get("underlying_symbols")) {
        return jsonResponse({ error: "Missing underlying_symbols" }, 400);
      }

      const alpaca = await proxyAlpacaJson(
        `${getBrokerBaseUrl(broker)}/v2/options/contracts?${params.toString()}`,
        headers,
      );

      return jsonResponse(alpaca.data, alpaca.ok ? 200 : alpaca.status);
    }

    const optionChainMatch = path.match(/\/alpaca\/options\/chain\/([^/]+)$/);
    if (optionChainMatch && req.method === "GET") {
      const { headers, error: credentialsError } = await getBrokerAccountAndHeaders(supabase, userId, url.searchParams.get('brokerId'));

      if (credentialsError || !headers) {
        return jsonResponse({ error: credentialsError }, 404);
      }

      const underlyingSymbol = optionChainMatch[1].toUpperCase();
      const params = new URLSearchParams(url.search);
      params.delete('brokerId');
      if (!params.get("feed")) params.set("feed", "indicative");
      if (!params.get("limit")) params.set("limit", "1000");

      const alpaca = await proxyAlpacaJson(
        `https://data.alpaca.markets/v1beta1/options/snapshots/${underlyingSymbol}?${params.toString()}`,
        headers,
      );

      return jsonResponse(alpaca.data, alpaca.ok ? 200 : alpaca.status);
    }

    if (path.endsWith("/platform-orders/route") && req.method === "POST") {
      const body = await readJson(req);
      const order = body.order ?? body.intent ?? body;

      const { data, error } = await supabase
        .from("oms_orders")
        .insert({
          user_id: userId,
          broker_id: order.brokerId ?? order.broker_id ?? "unassigned",
          strategy_id: order.strategyId ?? order.strategy_id ?? null,
          source: order.source ?? "manual",
          asset_class: order.assetClass ?? order.asset_class ?? "equity",
          instrument_type: order.instrumentType ?? order.instrument_type ?? "equity",
          status: order.status ?? "accepted",
          estimated_notional: order.estimatedNotional ?? order.estimated_notional ?? 0,
          filled_quantity: order.filledQuantity ?? order.filled_quantity ?? 0,
          average_fill_price: order.averageFillPrice ?? order.average_fill_price ?? 0,
          legs: order.legs ?? [],
          instructions: order.instructions ?? {},
          capability_warnings: order.capabilityWarnings ?? order.capability_warnings ?? [],
          raw_signal: order.rawSignal ?? order.raw_signal ?? body,
        })
        .select("*")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to route platform order", details: error.message }, 500);
      }

      return jsonResponse({ ok: true, order: data });
    }

    const reconcileMatch = path.match(/\/platform-orders\/([^/]+)\/reconcile$/);
    if (reconcileMatch && req.method === "POST") {
      const orderId = reconcileMatch[1];
      const body = await readJson(req);
      const updates = Array.isArray(body.updates) ? body.updates : [];

      if (updates.length > 0) {
        const { error: insertError } = await supabase.from("oms_executions").insert(
          updates.map((update: any) => ({
            oms_order_id: orderId,
            broker_order_id: update.brokerOrderId ?? update.broker_order_id ?? null,
            leg_id: update.legId ?? update.leg_id ?? null,
            status: update.status ?? "reconciled",
            filled_quantity: update.filledQuantity ?? update.filled_quantity ?? 0,
            average_fill_price: update.averageFillPrice ?? update.average_fill_price ?? 0,
            raw_update: update,
            occurred_at: update.occurredAt ?? update.occurred_at ?? new Date().toISOString(),
          })),
        );

        if (insertError) {
          return jsonResponse({ error: "Failed to insert execution updates", details: insertError.message }, 500);
        }
      }

      const latestStatus = updates[updates.length - 1]?.status ?? "reconciled";
      const { data, error } = await supabase
        .from("oms_orders")
        .update({
          status: latestStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to update OMS order", details: error.message }, 500);
      }

      return jsonResponse({ ok: true, order: data, executions_inserted: updates.length });
    }

    if (path.endsWith("/strategy-automation/schedules") && req.method === "GET") {
      const { data, error } = await supabase
        .from("strategy_automation_schedules")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        return jsonResponse({ error: "Failed to load automation schedules", details: error.message }, 500);
      }

      return jsonResponse(data ?? []);
    }

    const scheduleMatch = path.match(/\/strategy-automation\/schedules\/([^/]+)$/);
    if (scheduleMatch && req.method === "PUT") {
      const strategyId = scheduleMatch[1];
      const body = await readJson(req);
      const row = {
        user_id: userId,
        strategy_id: strategyId,
        enabled: Boolean(body.enabled),
        interval_minutes: Number(body.intervalMinutes ?? body.interval_minutes ?? 15),
        max_signals_per_run: Number(body.maxSignalsPerRun ?? body.max_signals_per_run ?? 1),
        min_confidence: Number(body.minConfidence ?? body.min_confidence ?? 0.7),
        allowed_symbols: Array.isArray(body.allowedSymbols)
          ? body.allowedSymbols
          : Array.isArray(body.allowed_symbols)
            ? body.allowed_symbols
            : [],
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("strategy_automation_schedules")
        .upsert(row, { onConflict: "user_id,strategy_id" })
        .select("*")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to save automation schedule", details: error.message }, 500);
      }

      return jsonResponse({ ok: true, schedule: data });
    }

    if (path.endsWith("/strategy-automation/run") && req.method === "POST") {
      const body = await readJson(req);
      const strategyId = body.strategy_id ?? body.strategyId;

      if (!strategyId) {
        return jsonResponse({ error: "Missing strategy_id" }, 400);
      }

      const { data, error } = await supabase
        .from("strategy_automation_runs")
        .insert({
          user_id: userId,
          strategy_id: strategyId,
          status: "queued",
          metadata: body.metadata ?? body,
        })
        .select("*")
        .single();

      if (error) {
        return jsonResponse({ error: "Failed to queue automation run", details: error.message }, 500);
      }

      return jsonResponse({ ok: true, run: data });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { supabase, error: clientError } = await getSupabaseClient();

  if (clientError || !supabase) {
    return jsonResponse({ error: clientError }, 500);
  }

  let payload: any = {};

  try {
    payload = decodeWebhookBody(await req.text(), req.headers.get('content-type') || '');
  } catch {
    const response = { error: "Invalid webhook body: expected JSON object or option text" };
    await insertWebhookOrderRequestLog(supabase, {
      req,
      url,
      payload,
      status: "invalid_json",
      httpStatus: 400,
      error: response.error,
      response,
    });
    return jsonResponse(response, 400);
  }

  const tokenFromUrl = url.searchParams.get("token");
  const legacyStrategyId = extractLegacyTradingViewStrategyId(path);
  const token =
    tokenFromUrl ??
    payload?.route_token ??
    payload?.webhook_token ??
    payload?.route_id ??
    payload?.token ??
    null;

  let requestLog = await insertWebhookOrderRequestLog(supabase, {
    req,
    url,
    token,
    payload,
    status: "received",
    httpStatus: 202,
  });

  if (!isWebhookIngressPath(path)) {
    const response = { error: "Route not found", path };
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: "route_not_found",
      httpStatus: 404,
      error: response.error,
      response,
    });
    return jsonResponse(response, 404);
  }

  const configuredSecret = Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET");

  if (configuredSecret) {
    const providedSecret =
      req.headers.get("x-webhook-secret") ??
      payload?.secret ??
      payload?.token ??
      null;

    if (providedSecret && providedSecret !== configuredSecret) {
      const response = { error: "Invalid webhook secret" };
      await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
        status: "invalid_secret",
        httpStatus: 401,
        error: response.error,
        response,
      });
      return jsonResponse(response, 401);
    }
  }

  if (!token) {
    const response = {
      error: "Missing route token",
      expected:
        "Use ?token=test-route-001 in URL or include route_token in JSON body",
    };
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: "missing_token",
      httpStatus: 400,
      error: response.error,
      response,
    });
    return jsonResponse(response, 400);
  }

  if (isOptionMessagePayload(payload)) {
    if (configuredSecret && req.headers.get('x-webhook-secret') !== configuredSecret && payload.secret !== configuredSecret) {
      return jsonResponse({ error: 'Missing or invalid webhook secret' }, 401);
    }
    const response = await receiveOptionMessage(req, supabase, payload, token, legacyStrategyId, requestLog?.id);
    const result = await response.clone().json();
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: response.ok ? 'option_plan_queued' : 'option_plan_rejected', httpStatus: response.status,
      response: result, error: result.error ?? null,
    });
    return response;
  }

  if (legacyStrategyId) {
    let alpacaOrder: Record<string, any>;
    try {
      alpacaOrder = buildAlpacaOrderFromWebhookPayload(payload, {
        clientOrderId: `tv-${crypto.randomUUID()}`,
      });
    } catch (orderError: any) {
      const response = { error: orderError?.message || "Invalid webhook order payload" };
      await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
        status: "invalid_order_payload",
        httpStatus: 400,
        error: response.error,
        response,
      });
      return jsonResponse(response, 400);
    }

    const response = {
      ok: true,
      status: "queued",
      strategyId: legacyStrategyId,
      message: "TradingView webhook received and queued for Alpaca submission.",
    };
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: "queued",
      httpStatus: 202,
      response,
    });
    runWebhookBackgroundTask(() =>
      processLegacyTradingViewOrder({
        supabase,
        requestLogId: requestLog?.id,
        legacyStrategyId,
        token,
        payload,
        alpacaOrder,
      })
    );
    return jsonResponse(response, 202);
  }

  const { data: route, error: routeError } = await supabase
    .from("webhook_routes")
    .select("*")
    .eq("token", token)
    .eq("status", "active")
    .maybeSingle();

  if (routeError) {
    const response = {
      error: "webhook_routes lookup failed",
      details: routeError.message,
      hint: routeError.hint,
      code: routeError.code,
    };
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: "route_lookup_failed",
      httpStatus: 500,
      error: response.error,
      response,
    });
    return jsonResponse(response, 500);
  }

  if (!route) {
    const response = {
      error: "No active webhook route found",
      token,
    };
    await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
      status: "route_not_active",
      httpStatus: 404,
      error: response.error,
      response,
    });
    return jsonResponse(response, 404);
  }

  await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
    status: "route_matched",
    httpStatus: 202,
    route,
    response: { route_id: route.id },
  });

  const { error: eventInsertError } = await supabase
    .from("webhook_events")
    .insert({
      route_id: route.id,
      user_id: route.user_id ?? null,
      strategy_id: route.strategy_id ?? null,
      broker_account_id: route.broker_account_id ?? null,
      payload,
      status: "received",
    })
    .select("*")
    .maybeSingle();

  const insertedEvent = !eventInsertError ? (await supabase
    .from("webhook_events")
    .select("*")
    .eq("route_id", route.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()).data : null;

  if (eventInsertError) {
    console.error("webhook_events insert failed:", eventInsertError);
  }

  const { error: routeUpdateError } = await supabase
    .from("webhook_routes")
    .update({
      triggers: (route.triggers ?? 0) + 1,
      last_triggered: new Date().toISOString(),
    })
    .eq("id", route.id);

  if (routeUpdateError) {
    console.error("webhook_routes update failed:", routeUpdateError);
  }

  const { data: latestExport } = await supabase
    .from("strategy_lab_exports")
    .select("*")
    .eq("route_id", route.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (route.user_id) {
    try {
      const signal = buildStrategyLabSignalFromPayload(payload || {}, {
        fallbackSource: "webhook",
        strategyId: route.strategy_id ?? null,
      });
      const [{ snapshot, error: snapshotError }, riskSettings] = await Promise.all([
        fetchAlpacaBrokerSnapshot(supabase, route.user_id, route.broker_account_id ?? null),
        getRiskSettings(supabase, route.user_id),
      ]);

      if (snapshotError || !snapshot) {
        throw new Error(snapshotError || "Failed to load broker snapshot");
      }

      const routed = createOrderLifecycleFromSignal({
        signal,
        broker: snapshot.connection,
        userId: route.user_id,
        account: snapshot.account,
        positions: snapshot.positions,
        openOrders: snapshot.openOrders,
        riskSettings,
      });

      const { data: auditRow, error: auditError } = await supabase
        .from("risk_audit_records")
        .insert(buildRiskAuditInsertRow(routed.auditRecord))
        .select("*")
        .single();

      if (auditError) {
        throw new Error(`Failed to persist risk audit record: ${auditError.message}`);
      }

      const { data: orderRow, error: orderError } = await supabase
        .from("oms_orders")
        .insert(buildOmsOrderInsertRow(route.user_id, routed.order))
        .select("*")
        .single();

      if (orderError) {
        throw new Error(`Failed to persist OMS order: ${orderError.message}`);
      }

      if (insertedEvent?.id) {
        const { error: eventUpdateError } = await supabase
          .from("webhook_events")
          .update(buildWebhookEventStatusUpdate({
            status: routed.riskDecision.status === "block" ? "blocked" : "accepted",
            orderId: orderRow.id,
            auditRecordId: auditRow.id,
            riskDecision: routed.riskDecision,
            exportId: latestExport?.id ?? null,
          }))
          .eq("id", insertedEvent.id);

        if (eventUpdateError) {
          console.error("webhook_events routing update failed:", eventUpdateError);
        }
      }

      const response = {
        ok: true,
        matched_route: route,
        routing: {
          status: routed.riskDecision.status === "block" ? "blocked" : "accepted",
          order: orderRow,
          riskDecision: routed.riskDecision,
          auditRecord: auditRow,
          exportRecordId: latestExport?.id ?? null,
        },
        message: routed.riskDecision.status === "block"
          ? "Webhook received and blocked by risk controls."
          : "Webhook received and routed through OMS.",
      };
      await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
        status: routed.riskDecision.status === "block" ? "blocked" : "accepted",
        httpStatus: 200,
        response,
        route,
      });
      return jsonResponse(response);
    } catch (routingError: any) {
      if (insertedEvent?.id) {
        const { error: eventUpdateError } = await supabase
          .from("webhook_events")
          .update({
            status: "routing_failed",
            decision_summary: routingError?.message || "Routing failed",
          })
          .eq("id", insertedEvent.id);

        if (eventUpdateError) {
          console.error("webhook_events failure update failed:", eventUpdateError);
        }
      }

      await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
        status: "routing_failed",
        httpStatus: 200,
        error: routingError?.message || "Routing failed",
        response: { warning: routingError?.message || "Routing failed" },
        route,
      });
      console.warn("Webhook routing skipped or failed:", routingError?.message || routingError);
    }
  }

  const response = {
    ok: true,
    matched_route: route,
    message: "Webhook received successfully. Broker execution not added yet.",
  };
  await updateWebhookOrderRequestLog(supabase, requestLog?.id, {
    status: "accepted",
    httpStatus: 200,
    response,
    route,
  });
  return jsonResponse(response);
});

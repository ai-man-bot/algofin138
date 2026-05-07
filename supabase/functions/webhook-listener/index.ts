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
  isRootWebhookIngressPath,
  normalizeBrokerConnectPayload,
} from "../../../src/utils/webhookRouteMatching.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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

async function getAlpacaHeaders(supabase: any, userId: string) {
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

  const { data: credentialRows } = await supabase
    .from("broker_credentials")
    .select("api_key, api_secret, broker_account_id")
    .eq("user_id", userId)
    .limit(5);

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

async function readJson(req: Request) {
  return req.json().catch(() => ({}));
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
    getAlpacaHeaders(supabase, userId),
  ]);

  if (credentialsError || !headers) {
    return {
      snapshot: null,
      error: credentialsError || "No Alpaca credentials found. Connect an Alpaca broker account first.",
    };
  }

  const [account, positions, orders] = await Promise.all([
    proxyAlpacaJson("https://paper-api.alpaca.markets/v2/account", headers),
    proxyAlpacaJson("https://paper-api.alpaca.markets/v2/positions", headers),
    proxyAlpacaJson("https://paper-api.alpaca.markets/v2/orders?status=all&limit=500&direction=desc", headers),
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

  return { brokers: data ?? [], error: null };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  const strategyLabResponse = await handleStrategyLabRoutes(req, path, jsonResponse);
  if (strategyLabResponse) {
    return strategyLabResponse;
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
      await supabase
        .from("broker_credentials")
        .delete()
        .eq("user_id", userId)
        .eq("broker_account_id", brokerId);

      const { error } = await supabase
        .from("broker_accounts")
        .delete()
        .eq("user_id", userId)
        .eq("id", brokerId);

      return error
        ? jsonResponse({ error: "Failed to disconnect broker", details: error.message }, 500)
        : jsonResponse({ success: true });
    }
  }

  if (
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

    if (path.endsWith("/alpaca/options/contracts") && req.method === "GET") {
      const { headers, error: credentialsError } = await getAlpacaHeaders(supabase, userId);

      if (credentialsError || !headers) {
        return jsonResponse({ error: credentialsError }, 404);
      }

      const params = new URLSearchParams(url.search);
      if (!params.get("underlying_symbols")) {
        return jsonResponse({ error: "Missing underlying_symbols" }, 400);
      }

      const alpaca = await proxyAlpacaJson(
        `https://paper-api.alpaca.markets/v2/options/contracts?${params.toString()}`,
        headers,
      );

      return jsonResponse(alpaca.data, alpaca.ok ? 200 : alpaca.status);
    }

    const optionChainMatch = path.match(/\/alpaca\/options\/chain\/([^/]+)$/);
    if (optionChainMatch && req.method === "GET") {
      const { headers, error: credentialsError } = await getAlpacaHeaders(supabase, userId);

      if (credentialsError || !headers) {
        return jsonResponse({ error: credentialsError }, 404);
      }

      const underlyingSymbol = optionChainMatch[1].toUpperCase();
      const params = new URLSearchParams(url.search);
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

  if (!isRootWebhookIngressPath(path)) {
    return jsonResponse({ error: "Route not found" }, 404);
  }

  const tokenFromUrl = url.searchParams.get("token");

  let payload: any = {};

  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const configuredSecret = Deno.env.get("TRADINGVIEW_WEBHOOK_SECRET");

  if (configuredSecret) {
    const providedSecret =
      req.headers.get("x-webhook-secret") ??
      payload?.secret ??
      payload?.token ??
      null;

    if (providedSecret && providedSecret !== configuredSecret) {
      return jsonResponse({ error: "Invalid webhook secret" }, 401);
    }
  }

  const token =
    tokenFromUrl ??
    payload?.route_token ??
    payload?.webhook_token ??
    payload?.route_id ??
    payload?.token ??
    null;

  if (!token) {
    return jsonResponse(
      {
        error: "Missing route token",
        expected:
          "Use ?token=test-route-001 in URL or include route_token in JSON body",
      },
      400,
    );
  }

  const { supabase, error: clientError } = await getSupabaseClient();

  if (clientError || !supabase) {
    return jsonResponse({ error: clientError }, 500);
  }

  const { data: route, error: routeError } = await supabase
    .from("webhook_routes")
    .select("*")
    .eq("token", token)
    .eq("status", "active")
    .maybeSingle();

  if (routeError) {
    return jsonResponse(
      {
        error: "webhook_routes lookup failed",
        details: routeError.message,
        hint: routeError.hint,
        code: routeError.code,
      },
      500,
    );
  }

  if (!route) {
    return jsonResponse(
      {
        error: "No active webhook route found",
        token,
      },
      404,
    );
  }

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

      return jsonResponse({
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
      });
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

      console.warn("Webhook routing skipped or failed:", routingError?.message || routingError);
    }
  }

  return jsonResponse({
    ok: true,
    matched_route: route,
    message: "Webhook received successfully. Broker execution not added yet.",
  });
});

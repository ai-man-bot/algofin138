import { parseTradeAssistantInput } from "./trade_assistant_parser.ts";
import { normalizeBrokerSnapshot } from "../../../utils/brokerModels.ts";
import { createRiskAuditRecord, evaluateRisk } from "../../../utils/riskEngine.ts";

type JsonResponseFn = (body: unknown, status?: number) => Response;

type HandleTradeAssistantArgs = {
  req: Request;
  path: string;
  supabase: any;
  userId: string | null;
  jsonResponse: JsonResponseFn;
};

function isCrypto(symbol: string) {
  const upper = symbol.toUpperCase();
  return upper.endsWith("USD") && !["SPY", "QQQ", "TQQQ", "SQQQ"].includes(upper);
}

async function getSelectedOrDefaultBroker(
  supabase: any,
  userId: string,
  brokerAccountId?: string | null,
) {
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
    return {
      broker: null,
      error: error?.message || "No connected Alpaca broker account found",
    };
  }

  return { broker: data, error: null };
}

async function getBrokerCredentials(supabase: any, userId: string, brokerAccountId: string) {
  const { data, error } = await supabase
    .from("broker_credentials")
    .select("*")
    .eq("broker_account_id", brokerAccountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return {
      credentials: null,
      error: error?.message || "Broker credentials not found",
    };
  }

  return { credentials: data, error: null };
}

async function submitAlpacaOrder(broker: any, credentials: any, order: any) {
  const baseUrl =
    broker.base_url ||
    (broker.paper
      ? "https://paper-api.alpaca.markets"
      : "https://api.alpaca.markets");

  const alpacaPayload: Record<string, any> = {
    symbol: order.symbol,
    side: order.side,
    type: order.order_type || "market",
    time_in_force:
      order.time_in_force ||
      (isCrypto(order.symbol) ? "gtc" : "day"),
    client_order_id:
      order.client_order_id ||
      `ta-${crypto.randomUUID()}`,
  };

  if (order.qty != null) {
    alpacaPayload.qty = String(order.qty);
  }

  if (order.notional != null) {
    alpacaPayload.notional = String(order.notional);
  }

  if (order.order_type === "limit" && order.limit_price != null) {
    alpacaPayload.limit_price = String(order.limit_price);
  }

  if (order.position_intent) {
    alpacaPayload.position_intent = order.position_intent;
  }

  const response = await fetch(`${baseUrl}/v2/orders`, {
    method: "POST",
    headers: {
      "APCA-API-KEY-ID": credentials.api_key,
      "APCA-API-SECRET-KEY": credentials.api_secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(alpacaPayload),
  });

  const result = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    request: alpacaPayload,
    response: result,
  };
}

async function fetchJson(url: string, credentials: any) {
  const response = await fetch(url, {
    headers: {
      "APCA-API-KEY-ID": credentials.api_key,
      "APCA-API-SECRET-KEY": credentials.api_secret,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.json().catch(() => null);
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
    authorizedUserIds: Array.isArray(data.authorized_user_ids)
      ? data.authorized_user_ids
      : null,
  };
}

async function insertRiskAuditRecord(supabase: any, auditRecord: any) {
  await supabase
    .from("risk_audit_records")
    .insert({
      id: auditRecord.id,
      user_id: auditRecord.userId,
      source: auditRecord.source,
      broker_id: auditRecord.brokerId,
      status: auditRecord.status,
      summary: auditRecord.summary,
      issue_codes: auditRecord.issueCodes,
      issues: auditRecord.issues,
      estimated_order_notional: auditRecord.estimatedOrderNotional,
      projected_notional_exposure: auditRecord.projectedNotionalExposure,
      order_payload: auditRecord.order,
      created_at: auditRecord.createdAt,
    });
}

async function evaluateTradeAssistantRisk(
  supabase: any,
  userId: string,
  broker: any,
  credentials: any,
  finalOrder: any,
) {
  const baseUrl =
    broker.base_url ||
    (broker.paper
      ? "https://paper-api.alpaca.markets"
      : "https://api.alpaca.markets");

  const [account, positions, orders, riskSettings] = await Promise.all([
    fetchJson(`${baseUrl}/v2/account`, credentials),
    fetchJson(`${baseUrl}/v2/positions`, credentials),
    fetchJson(`${baseUrl}/v2/orders?status=all&limit=500&direction=desc`, credentials),
    getRiskSettings(supabase, userId),
  ]);

  const snapshot = normalizeBrokerSnapshot({
    connection: {
      ...broker,
      brokerType: broker.broker_type || broker.brokerType,
      connected: true,
    },
    account: account || {},
    positions: Array.isArray(positions) ? positions : [],
    orders: Array.isArray(orders) ? orders : [],
  });

  const order = {
    symbol: finalOrder.symbol,
    side: finalOrder.side,
    quantity: Number(finalOrder.qty),
    orderType: finalOrder.order_type || "market",
    assetClass: finalOrder.asset_class || "equity",
    limitPrice: finalOrder.limit_price ?? undefined,
    stopPrice: finalOrder.stop_price ?? undefined,
    requestedAt: new Date().toISOString(),
  };

  const decision = evaluateRisk({
    userId,
    order,
    broker: snapshot.connection,
    account: snapshot.account,
    positions: snapshot.positions,
    openOrders: snapshot.openOrders,
    riskSettings,
  });

  const auditRecord = createRiskAuditRecord({
    userId,
    source: "trade_assistant",
    brokerId: snapshot.connection.id,
    order,
    decision,
  });

  await insertRiskAuditRecord(supabase, auditRecord).catch((error: any) => {
    console.warn("Risk audit insert failed; continuing with decision", error?.message || error);
  });

  return { decision, auditRecord };
}

function buildOrderWithOverrides(parsed: any, overrides: any = {}) {
  const qty =
    overrides.qty !== undefined && overrides.qty !== null && overrides.qty !== ""
      ? Number(overrides.qty)
      : parsed.qty;

  const orderType =
    overrides.order_type ||
    overrides.orderType ||
    parsed.order_type ||
    "market";

  const limitPrice =
    overrides.limit_price !== undefined && overrides.limit_price !== null && overrides.limit_price !== ""
      ? Number(overrides.limit_price)
      : parsed.limit_price;

  const timeInForce =
    overrides.time_in_force ||
    overrides.timeInForce ||
    parsed.time_in_force ||
    (isCrypto(parsed.symbol) ? "gtc" : "day");

  return {
    ...parsed,
    qty,
    order_type: orderType,
    limit_price: limitPrice,
    time_in_force: timeInForce,
    client_order_id:
      overrides.client_order_id ||
      overrides.clientOrderId ||
      parsed.client_order_id ||
      `ta-${crypto.randomUUID()}`,
  };
}

export async function handleTradeAssistantRoutes({
  req,
  path,
  supabase,
  userId,
  jsonResponse,
}: HandleTradeAssistantArgs) {
  if (!path.includes("/trade-assistant/")) {
    return null;
  }

  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (path.endsWith("/trade-assistant/parse")) {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => null);

    if (!body?.input) {
      return jsonResponse({ error: "Missing input" }, 400);
    }

    let parsedOrder: any;

    try {
      parsedOrder = parseTradeAssistantInput(String(body.input));
    } catch (error: any) {
      return jsonResponse(
        {
          error: "Failed to parse trade instruction",
          details: error?.message ?? String(error),
        },
        400,
      );
    }

    const { broker, error: brokerError } = await getSelectedOrDefaultBroker(
      supabase,
      userId,
      body.broker_account_id ?? body.brokerAccountId ?? null,
    );

    if (brokerError || !broker) {
      return jsonResponse(
        {
          error: "No connected Alpaca broker account found",
          details: brokerError,
        },
        404,
      );
    }

    parsedOrder.broker_account_id = broker.id;

    const { data: requestRow, error: insertError } = await supabase
      .from("trade_assistant_requests")
      .insert({
        user_id: userId,
        broker_account_id: broker.id,
        raw_input: body.input,
        parsed_order: parsedOrder,
        status: "parsed",
        source_type: parsedOrder.source_type ?? null,
        asset_class: parsedOrder.asset_class ?? null,
        option_symbol: parsedOrder.option_symbol ?? null,
        underlying_symbol: parsedOrder.underlying_symbol ?? null,
        option_type: parsedOrder.option_type ?? null,
        expiration_date: parsedOrder.expiration_date ?? null,
        strike_price: parsedOrder.strike_price ?? null,
        target_price: parsedOrder.target_price ?? null,
        stop_price: parsedOrder.stop_price ?? null,
        target_percent: parsedOrder.target_percent ?? null,
        confidence: parsedOrder.confidence ?? null,
        warnings: parsedOrder.warnings ?? [],
      })
      .select("*")
      .single();

    if (insertError) {
      return jsonResponse(
        {
          error: "Failed to save parsed trade assistant request",
          details: insertError.message,
          hint: insertError.hint,
        },
        500,
      );
    }

    return jsonResponse({
      ok: true,
      request_id: requestRow.id,
      parsed_order: parsedOrder,
      broker: {
        id: broker.id,
        name: broker.name,
        account_id: broker.account_id,
        paper: broker.paper,
      },
      requires_confirmation: true,
    });
  }

  if (path.endsWith("/trade-assistant/confirm")) {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => null);

    const requestId = body?.request_id || body?.requestId;

    if (!requestId) {
      return jsonResponse({ error: "Missing request_id" }, 400);
    }

    const { data: requestRow, error: requestError } = await supabase
      .from("trade_assistant_requests")
      .select("*")
      .eq("id", requestId)
      .eq("user_id", userId)
      .maybeSingle();

    if (requestError || !requestRow) {
      return jsonResponse(
        {
          error: "Trade assistant request not found",
          details: requestError?.message,
        },
        404,
      );
    }

    if (requestRow.status === "submitted" || requestRow.status === "executed") {
      return jsonResponse(
        {
          error: "This trade assistant request has already been submitted",
          request_id: requestId,
          status: requestRow.status,
        },
        409,
      );
    }

    const parsed = requestRow.parsed_order || {};
    const overrides = body?.overrides || body || {};
    const finalOrder = buildOrderWithOverrides(parsed, overrides);

    if (!finalOrder.symbol || !["buy", "sell"].includes(finalOrder.side)) {
      return jsonResponse(
        {
          error: "Invalid parsed order",
          parsed_order: parsed,
        },
        400,
      );
    }

    if (
      finalOrder.qty == null ||
      !Number.isFinite(Number(finalOrder.qty)) ||
      Number(finalOrder.qty) <= 0
    ) {
      return jsonResponse(
        {
          error: "Quantity is required before submitting this order",
          parsed_order: parsed,
        },
        400,
      );
    }

    if (
      finalOrder.order_type === "limit" &&
      (finalOrder.limit_price == null ||
        !Number.isFinite(Number(finalOrder.limit_price)) ||
        Number(finalOrder.limit_price) <= 0)
    ) {
      return jsonResponse(
        {
          error: "Limit price is required for limit orders",
          parsed_order: parsed,
        },
        400,
      );
    }

    const { broker, error: brokerError } = await getSelectedOrDefaultBroker(
      supabase,
      userId,
      requestRow.broker_account_id,
    );

    if (brokerError || !broker) {
      return jsonResponse(
        {
          error: "Broker account not found",
          details: brokerError,
        },
        404,
      );
    }

    const { credentials, error: credentialsError } = await getBrokerCredentials(
      supabase,
      userId,
      broker.id,
    );

    if (credentialsError || !credentials) {
      return jsonResponse(
        {
          error: "Broker credentials not found",
          details: credentialsError,
        },
        404,
      );
    }

    const { decision: riskDecision, auditRecord } = await evaluateTradeAssistantRisk(
      supabase,
      userId,
      broker,
      credentials,
      finalOrder,
    );

    if (riskDecision.status === "block") {
      await supabase
        .from("trade_assistant_requests")
        .update({
          status: "blocked",
          parsed_order: finalOrder,
          error: riskDecision.summary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      return jsonResponse(
        {
          error: "Order blocked by risk controls",
          risk_decision: riskDecision,
          risk_audit_id: auditRecord.id,
        },
        403,
      );
    }

    const alpaca = await submitAlpacaOrder(broker, credentials, finalOrder);

    if (!alpaca.ok) {
      await supabase
        .from("trade_assistant_requests")
        .update({
          status: "failed",
          error: JSON.stringify(alpaca.response),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);

      await supabase.from("trades").insert({
        user_id: userId,
        strategy_id: null,
        strategy_name: "Trade Assistant",
        symbol: finalOrder.symbol,
        side: finalOrder.side,
        quantity: finalOrder.qty,
        order_type: finalOrder.order_type,
        status: "failed",
        source: "trade_assistant",
        broker: "alpaca",
        broker_id: broker.broker_type,
        broker_account_id: broker.id,
        broker_response: alpaca.response,
        error: JSON.stringify(alpaca.response),
        asset_class: finalOrder.asset_class ?? null,
        option_symbol: finalOrder.option_symbol ?? null,
        underlying_symbol: finalOrder.underlying_symbol ?? null,
        option_type: finalOrder.option_type ?? null,
        expiration_date: finalOrder.expiration_date ?? null,
        strike_price: finalOrder.strike_price ?? null,
        target_price: finalOrder.target_price ?? null,
        stop_price: finalOrder.stop_price ?? null,
        target_percent: finalOrder.target_percent ?? null,
      });

      return jsonResponse(
        {
          error: "Alpaca order failed",
          alpaca_status: alpaca.status,
          alpaca_response: alpaca.response,
          alpaca_request: alpaca.request,
        },
        400,
      );
    }

    await supabase
      .from("trade_assistant_requests")
      .update({
        status: "submitted",
        parsed_order: finalOrder,
        alpaca_order: alpaca.response,
        risk_decision: riskDecision,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    await supabase.from("trades").insert({
      user_id: userId,
      strategy_id: null,
      strategy_name: "Trade Assistant",
      symbol: finalOrder.symbol,
      side: finalOrder.side,
      quantity: finalOrder.qty,
      order_type: finalOrder.order_type,
      status: alpaca.response?.status ?? "submitted",
      source: "trade_assistant",
      broker: "alpaca",
      broker_id: broker.broker_type,
      broker_account_id: broker.id,
      broker_order_id: alpaca.response?.id ?? null,
      broker_response: alpaca.response,
      submitted_at: alpaca.response?.submitted_at ?? new Date().toISOString(),
      filled_at: alpaca.response?.filled_at ?? null,
      entry_price: alpaca.response?.filled_avg_price
        ? Number(alpaca.response.filled_avg_price)
        : finalOrder.limit_price ?? null,
      asset_class: finalOrder.asset_class ?? null,
      option_symbol: finalOrder.option_symbol ?? null,
      underlying_symbol: finalOrder.underlying_symbol ?? null,
      option_type: finalOrder.option_type ?? null,
      expiration_date: finalOrder.expiration_date ?? null,
      strike_price: finalOrder.strike_price ?? null,
      target_price: finalOrder.target_price ?? null,
      stop_price: finalOrder.stop_price ?? null,
      target_percent: finalOrder.target_percent ?? null,
      client_order_id: alpaca.request?.client_order_id ?? null,
    });

    return jsonResponse({
      ok: true,
      request_id: requestId,
      order: finalOrder,
      risk_decision: riskDecision,
      risk_audit_id: auditRecord.id,
      alpaca_request: alpaca.request,
      alpaca_order: alpaca.response,
    });
  }

  return jsonResponse({ error: "Trade Assistant route not found" }, 404);
}

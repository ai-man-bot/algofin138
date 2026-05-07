import { createClient } from "npm:@supabase/supabase-js@2.45.2";
import { runStrategyLabBacktest } from "../../../src/utils/backtestEngine.ts";
import { runStrategyLabOptimization } from "../../../src/utils/optimizerEngine.ts";
import { generateStrategyLabPineScript } from "../../../src/utils/pinescriptGenerator.ts";
import {
  fetchAlpacaBars,
  fetchAlpacaQuote,
  type AlpacaMarketDataCredentials,
} from "../../../src/utils/strategyLabMarketData.ts";
import { buildStrategyLabExportRow } from "../../../src/utils/orderRoutingPersistence.ts";
import {
  createStrategyLabStrategyDefinition,
  normalizeStrategyLabSymbol,
  type StrategyLabBarTimeframe,
} from "../../../src/utils/strategyLabModels.ts";

type JsonResponseFn = (body: unknown, status?: number) => Response;

const DEFAULT_TIMEFRAME: StrategyLabBarTimeframe = "1D";

async function readJson(req: Request) {
  return req.json().catch(() => ({}));
}

function periodToStart(period: string | null) {
  const now = new Date();
  const normalized = String(period || "2y").trim().toLowerCase();
  const amount = Number.parseInt(normalized, 10) || 2;

  if (normalized.endsWith("mo")) {
    now.setMonth(now.getMonth() - amount);
  } else if (normalized.endsWith("d")) {
    now.setDate(now.getDate() - amount);
  } else {
    now.setFullYear(now.getFullYear() - amount);
  }

  return now.toISOString();
}

async function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return { supabase: null, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  return {
    supabase: createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }),
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

async function getAlpacaCredentials(supabase: any, userId: string): Promise<{ credentials: AlpacaMarketDataCredentials | null; error: string | null }> {
  const envKey = Deno.env.get("ALPACA_API_KEY") ?? Deno.env.get("APCA_API_KEY_ID");
  const envSecret = Deno.env.get("ALPACA_API_SECRET") ?? Deno.env.get("APCA_API_SECRET_KEY");

  if (envKey && envSecret) {
    return { credentials: { key: envKey, secret: envSecret }, error: null };
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
    return { credentials: { key: credential.api_key, secret: credential.api_secret }, error: null };
  }

  return { credentials: null, error: "No Alpaca credentials found. Connect an Alpaca broker account first." };
}

function rowToStrategy(row: any) {
  return createStrategyLabStrategyDefinition({
    name: row.name,
    symbol: row.symbol,
    assetClass: row.asset_class,
    direction: row.direction,
    indicators: row.indicators,
    entryRules: row.entry_rules,
    exitRules: row.exit_rules,
    risk: row.risk,
    positionSizing: row.position_sizing,
    metadata: row.metadata,
  });
}

function strategyToRow(strategy: ReturnType<typeof createStrategyLabStrategyDefinition>, userId: string) {
  return {
    user_id: userId,
    name: strategy.name,
    symbol: strategy.symbol,
    asset_class: strategy.assetClass,
    direction: strategy.direction,
    indicators: strategy.indicators,
    entry_rules: strategy.entryRules,
    exit_rules: strategy.exitRules,
    risk: strategy.risk,
    position_sizing: strategy.positionSizing,
    metadata: strategy.metadata,
    updated_at: new Date().toISOString(),
  };
}

async function loadStrategy(supabase: any, userId: string, strategyId: string) {
  const { data, error } = await supabase
    .from("strategy_lab_strategies")
    .select("*")
    .eq("id", strategyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { row: null, strategy: null, error: error?.message || "StrategyLab strategy not found" };
  }

  return { row: data, strategy: rowToStrategy(data), error: null };
}

async function ensureWebhookRoute(supabase: any, userId: string, body: any, strategyRow: any) {
  if (body.webhookRouteId || body.webhook_route_id) {
    const routeId = body.webhookRouteId ?? body.webhook_route_id;
    const { data, error } = await supabase
      .from("webhook_routes")
      .select("*")
      .eq("id", routeId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) {
      return { route: null, error: error?.message || "Webhook route not found" };
    }

    return { route: data, error: null };
  }

  const token = crypto.randomUUID();

  const primaryInsert = await supabase
    .from("webhook_routes")
    .insert({
      user_id: userId,
      strategy_id: strategyRow.id,
      token,
      status: "active",
    })
    .select("*")
    .single();

  if (!primaryInsert.error && primaryInsert.data) {
    return { route: primaryInsert.data, error: null };
  }

  const fallbackInsert = await supabase
    .from("webhook_routes")
    .insert({
      user_id: userId,
      token,
      status: "active",
    })
    .select("*")
    .single();

  if (fallbackInsert.error) {
    return { route: null, error: fallbackInsert.error.message || primaryInsert.error?.message };
  }

  return { route: fallbackInsert.data, error: null };
}

async function fetchBarsForRequest(supabase: any, userId: string, body: any, fallbackSymbol: string) {
  const { credentials, error } = await getAlpacaCredentials(supabase, userId);
  if (error || !credentials) throw new Error(error || "Missing Alpaca credentials");

  const symbol = normalizeStrategyLabSymbol(body.symbol || fallbackSymbol);
  const timeframe = (body.timeframe || DEFAULT_TIMEFRAME) as StrategyLabBarTimeframe;
  const start = body.periodStart || body.period_start || periodToStart(body.period || "2y");
  const end = body.periodEnd || body.period_end || new Date().toISOString();

  return fetchAlpacaBars({
    symbol,
    timeframe,
    start,
    end,
    limit: Number(body.limit || 1000),
    credentials,
  });
}

export async function handleStrategyLabRoutes(req: Request, path: string, jsonResponse: JsonResponseFn): Promise<Response | null> {
  if (!path.includes("/strategy-lab/")) {
    return null;
  }

  const { supabase, error: clientError } = await getSupabaseClient();

  if (clientError || !supabase) {
    return jsonResponse({ error: clientError }, 500);
  }

  const { userId, error: authError } = await getAuthenticatedUserId(req, supabase);

  if (authError || !userId) {
    return jsonResponse({ error: authError }, 401);
  }

  const url = new URL(req.url);

  try {
    if (path.endsWith("/strategy-lab/market/quote") && req.method === "GET") {
      const symbol = normalizeStrategyLabSymbol(url.searchParams.get("symbol"));
      const { credentials, error } = await getAlpacaCredentials(supabase, userId);
      if (error || !credentials) return jsonResponse({ error }, 404);
      const quote = await fetchAlpacaQuote({ symbol, credentials });
      return jsonResponse({ quote });
    }

    if (path.endsWith("/strategy-lab/market/bars") && req.method === "GET") {
      const symbol = normalizeStrategyLabSymbol(url.searchParams.get("symbol"));
      const { credentials, error } = await getAlpacaCredentials(supabase, userId);
      if (error || !credentials) return jsonResponse({ error }, 404);
      const bars = await fetchAlpacaBars({
        symbol,
        timeframe: (url.searchParams.get("timeframe") || DEFAULT_TIMEFRAME) as StrategyLabBarTimeframe,
        start: url.searchParams.get("period_start") || periodToStart(url.searchParams.get("period")),
        end: url.searchParams.get("period_end") || new Date().toISOString(),
        limit: Number(url.searchParams.get("limit") || 1000),
        credentials,
      });
      return jsonResponse({ bars });
    }

    if (path.endsWith("/strategy-lab/strategies") && req.method === "POST") {
      const strategy = createStrategyLabStrategyDefinition(await readJson(req));
      const { data, error } = await supabase
        .from("strategy_lab_strategies")
        .insert(strategyToRow(strategy, userId))
        .select("*")
        .single();

      if (error) return jsonResponse({ error: "Failed to create StrategyLab strategy", details: error.message }, 500);
      return jsonResponse({ strategy: data }, 201);
    }

    const strategyMatch = path.match(/\/strategy-lab\/strategies\/([^/]+)$/);
    if (strategyMatch && req.method === "PUT") {
      const existing = await loadStrategy(supabase, userId, strategyMatch[1]);
      if (existing.error || !existing.strategy) return jsonResponse({ error: existing.error }, 404);

      const strategy = createStrategyLabStrategyDefinition({
        ...existing.strategy,
        ...(await readJson(req)),
      });
      const { data, error } = await supabase
        .from("strategy_lab_strategies")
        .update(strategyToRow(strategy, userId))
        .eq("id", strategyMatch[1])
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) return jsonResponse({ error: "Failed to update StrategyLab strategy", details: error.message }, 500);
      return jsonResponse({ strategy: data });
    }

    const pineMatch = path.match(/\/strategy-lab\/strategies\/([^/]+)\/pinescript$/);
    if (pineMatch && req.method === "POST") {
      const body = await readJson(req);
      const loaded = await loadStrategy(supabase, userId, pineMatch[1]);
      if (loaded.error || !loaded.strategy) return jsonResponse({ error: loaded.error }, 404);

      const routeToken = body.routeToken ?? body.route_token;
      const generated = generateStrategyLabPineScript({
        strategy: loaded.strategy,
        routeToken,
        strategyId: loaded.row.id,
      });

      await supabase
        .from("strategy_lab_strategies")
        .update({
          generated_pinescript: generated.code,
          generated_alert_payload: generated.alertPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", loaded.row.id)
        .eq("user_id", userId);

      return jsonResponse(generated);
    }

    if (path.endsWith("/strategy-lab/backtests") && req.method === "POST") {
      const body = await readJson(req);
      const strategyId = body.strategyId ?? body.strategy_id;
      const loaded = await loadStrategy(supabase, userId, strategyId);
      if (loaded.error || !loaded.strategy) return jsonResponse({ error: loaded.error }, 404);

      const bars = await fetchBarsForRequest(supabase, userId, body, loaded.strategy.symbol);
      const result = runStrategyLabBacktest({
        strategy: loaded.strategy,
        bars,
        initialCapital: Number(body.initialCapital ?? body.initial_capital ?? 10000),
        commissionBps: Number(body.commissionBps ?? body.commission_bps ?? 0),
      });

      const { data, error } = await supabase
        .from("strategy_lab_backtest_jobs")
        .insert({
          user_id: userId,
          strategy_id: loaded.row.id,
          status: result.status,
          symbol: normalizeStrategyLabSymbol(body.symbol || loaded.strategy.symbol),
          timeframe: body.timeframe || DEFAULT_TIMEFRAME,
          period_start: body.periodStart ?? body.period_start ?? null,
          period_end: body.periodEnd ?? body.period_end ?? null,
          initial_capital: Number(body.initialCapital ?? body.initial_capital ?? 10000),
          commission_bps: Number(body.commissionBps ?? body.commission_bps ?? 0),
          metrics: result.metrics,
          equity_curve: result.equityCurve,
          trade_log: result.trades,
          completed_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) return jsonResponse({ error: "Failed to persist backtest", details: error.message }, 500);
      return jsonResponse({ job: data, results: result }, 201);
    }

    const backtestMatch = path.match(/\/strategy-lab\/backtests\/([^/]+)$/);
    if (backtestMatch && req.method === "GET") {
      const { data, error } = await supabase
        .from("strategy_lab_backtest_jobs")
        .select("*")
        .eq("id", backtestMatch[1])
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) return jsonResponse({ error: error?.message || "Backtest job not found" }, 404);
      return jsonResponse({ job: data });
    }

    if (path.endsWith("/strategy-lab/optimizations") && req.method === "POST") {
      const body = await readJson(req);
      const strategyId = body.strategyId ?? body.strategy_id;
      const loaded = await loadStrategy(supabase, userId, strategyId);
      if (loaded.error || !loaded.strategy) return jsonResponse({ error: loaded.error }, 404);

      const bars = await fetchBarsForRequest(supabase, userId, body, loaded.strategy.symbol);
      const result = runStrategyLabOptimization({
        strategy: loaded.strategy,
        bars,
        targetMetric: body.targetMetric ?? body.target_metric ?? "sharpe",
        ranges: body.ranges ?? body.parameter_ranges,
        maxCombinations: Number(body.maxCombinations ?? body.max_combinations ?? 500),
      });

      const { data, error } = await supabase
        .from("strategy_lab_optimizer_jobs")
        .insert({
          user_id: userId,
          strategy_id: loaded.row.id,
          status: result.status,
          symbol: normalizeStrategyLabSymbol(body.symbol || loaded.strategy.symbol),
          target_metric: body.targetMetric ?? body.target_metric ?? "sharpe",
          parameter_ranges: body.ranges ?? body.parameter_ranges,
          max_combinations: Number(body.maxCombinations ?? body.max_combinations ?? 500),
          combinations_tested: result.combinationsTested,
          best_params: result.bestParams,
          ranked_results: result.results,
          completed_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) return jsonResponse({ error: "Failed to persist optimization", details: error.message }, 500);
      return jsonResponse({ job: data, results: result }, 201);
    }

    const optimizerMatch = path.match(/\/strategy-lab\/optimizations\/([^/]+)$/);
    if (optimizerMatch && req.method === "GET") {
      const { data, error } = await supabase
        .from("strategy_lab_optimizer_jobs")
        .select("*")
        .eq("id", optimizerMatch[1])
        .eq("user_id", userId)
        .maybeSingle();

      if (error || !data) return jsonResponse({ error: error?.message || "Optimizer job not found" }, 404);
      return jsonResponse({ job: data });
    }

    if (path.endsWith("/strategy-lab/exports/algofin") && req.method === "POST") {
      const body = await readJson(req);
      const strategyId = body.strategyId ?? body.strategy_id;
      const loaded = await loadStrategy(supabase, userId, strategyId);
      if (loaded.error || !loaded.strategy) return jsonResponse({ error: loaded.error }, 404);

      const { route, error } = await ensureWebhookRoute(supabase, userId, body, loaded.row);
      if (error || !route) return jsonResponse({ error: "Failed to create or link webhook route", details: error }, 500);

      const generated = generateStrategyLabPineScript({
        strategy: loaded.strategy,
        routeToken: route.token,
        strategyId: loaded.row.id,
      });

      const exportRow = buildStrategyLabExportRow({
        userId,
        strategyId: loaded.row.id,
        routeId: route.id,
        routeToken: route.token,
        mode: body.mode ?? "paper",
        alertPayload: generated.alertPayload,
        generatedPineScript: generated.code,
        webhookBaseUrl: new URL(req.url).origin,
      });

      const { data: exportRecord, error: exportError } = await supabase
        .from("strategy_lab_exports")
        .insert(exportRow)
        .select("*")
        .single();

      if (exportError) {
        return jsonResponse({ error: "Failed to persist StrategyLab export", details: exportError.message }, 500);
      }

      await supabase
        .from("strategy_lab_strategies")
        .update({
          generated_pinescript: generated.code,
          generated_alert_payload: generated.alertPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", loaded.row.id)
        .eq("user_id", userId);

      return jsonResponse({
        route,
        exportRecord,
        pinescript: generated.code,
        alertPayload: generated.alertPayload,
      }, 201);
    }

    return jsonResponse({ error: "StrategyLab route not found" }, 404);
  } catch (error: any) {
    return jsonResponse({ error: error?.message || "StrategyLab request failed" }, 400);
  }
}

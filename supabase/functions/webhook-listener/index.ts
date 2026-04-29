import { createClient } from "npm:@supabase/supabase-js@2.45.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url = new URL(req.url);
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

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
    });

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

  return jsonResponse({
    ok: true,
    matched_route: route,
    message: "Webhook received successfully. Broker execution not added yet.",
  });
});
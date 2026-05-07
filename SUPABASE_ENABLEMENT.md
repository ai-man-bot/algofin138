# Supabase Backend Enablement

This repo now contains a deployable Supabase backend at `supabase/` with:

- a root-level function folder at `supabase/functions/webhook-listener`
- a KV persistence migration at `supabase/migrations/202604150001_init_kv_store.sql`
- npm scripts to link, push the database schema, and deploy the edge function

## What this enables

- persistent storage in `public.kv_store_f118884a`
- the `webhook-listener` edge function for auth, dashboard data, trades, strategies, webhooks, notifications, brokers, Alpaca integration, OMS/risk routing, and StrategyLab endpoints

## One-time setup

1. Install the Supabase CLI if needed:

```bash
npm install -g supabase
```

2. Authenticate with Supabase:

```bash
npm run supabase:login
```

3. Link this repo to the existing project:

```bash
npm run supabase:link
```

## Enable persistence and deploy the function

```bash
npm run backend:enable
```

That runs:

- `supabase link --project-ref dzboqhobrmzglyuofcyk`
- `supabase db push`
- `supabase functions deploy webhook-listener --no-verify-jwt`

## Local development

To run the function locally:

```bash
npm run supabase:functions:serve
```

## Important notes

- The frontend and local Supabase CLI link both point at project `dzboqhobrmzglyuofcyk`.
- The function entrypoint serves the existing `/webhook-listener/...` API paths used by the frontend.
- `verify_jwt = false` is preserved for the deployed function because webhook endpoints need to accept unauthenticated external POST requests.

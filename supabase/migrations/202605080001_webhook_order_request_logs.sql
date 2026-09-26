create table if not exists public.webhook_order_request_logs (
  id uuid primary key default gen_random_uuid(),
  method text not null,
  path text not null,
  query jsonb not null default '{}'::jsonb,
  token text,
  route_id uuid,
  user_id uuid,
  strategy_id text,
  broker_account_id uuid,
  source text,
  symbol text,
  side text,
  status text not null,
  http_status integer not null,
  error_message text,
  request_headers jsonb not null default '{}'::jsonb,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists webhook_order_request_logs_created_idx
  on public.webhook_order_request_logs (created_at desc);

create index if not exists webhook_order_request_logs_token_created_idx
  on public.webhook_order_request_logs (token, created_at desc);

create index if not exists webhook_order_request_logs_status_created_idx
  on public.webhook_order_request_logs (status, created_at desc);

create index if not exists webhook_order_request_logs_user_created_idx
  on public.webhook_order_request_logs (user_id, created_at desc);

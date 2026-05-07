create table if not exists public.strategy_lab_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  symbol text not null,
  asset_class text not null default 'equity',
  direction text not null default 'long',
  indicators jsonb not null default '{}'::jsonb,
  entry_rules jsonb not null default '[]'::jsonb,
  exit_rules jsonb not null default '[]'::jsonb,
  risk jsonb not null default '{}'::jsonb,
  position_sizing jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_pinescript text,
  generated_alert_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.strategy_lab_backtest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null references public.strategy_lab_strategies(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'complete', 'failed', 'insufficient_data')),
  symbol text not null,
  timeframe text not null,
  period_start timestamptz,
  period_end timestamptz,
  initial_capital numeric not null default 10000,
  commission_bps numeric not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  equity_curve jsonb not null default '[]'::jsonb,
  trade_log jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.strategy_lab_optimizer_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null references public.strategy_lab_strategies(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'complete', 'failed')),
  symbol text not null,
  target_metric text not null default 'sharpe',
  parameter_ranges jsonb not null default '{}'::jsonb,
  max_combinations integer not null default 500,
  combinations_tested integer not null default 0,
  best_params jsonb,
  ranked_results jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists strategy_lab_strategies_user_updated_idx
  on public.strategy_lab_strategies (user_id, updated_at desc);

create index if not exists strategy_lab_strategies_user_symbol_idx
  on public.strategy_lab_strategies (user_id, symbol);

create index if not exists strategy_lab_backtest_jobs_user_strategy_created_idx
  on public.strategy_lab_backtest_jobs (user_id, strategy_id, created_at desc);

create index if not exists strategy_lab_backtest_jobs_user_status_created_idx
  on public.strategy_lab_backtest_jobs (user_id, status, created_at desc);

create index if not exists strategy_lab_optimizer_jobs_user_strategy_created_idx
  on public.strategy_lab_optimizer_jobs (user_id, strategy_id, created_at desc);

create index if not exists strategy_lab_optimizer_jobs_user_status_created_idx
  on public.strategy_lab_optimizer_jobs (user_id, status, created_at desc);

create table if not exists public.strategy_lab_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null references public.strategy_lab_strategies(id) on delete cascade,
  route_id uuid not null,
  route_token text not null,
  export_mode text not null default 'paper',
  source text not null default 'strategylab_pinescript',
  alert_payload jsonb not null default '{}'::jsonb,
  generated_pinescript text not null,
  webhook_path text not null,
  webhook_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategy_lab_exports_user_strategy_created_idx
  on public.strategy_lab_exports (user_id, strategy_id, created_at desc);

create index if not exists strategy_lab_exports_route_updated_idx
  on public.strategy_lab_exports (route_id, updated_at desc);

alter table if exists public.webhook_events
  add column if not exists order_id uuid,
  add column if not exists risk_audit_record_id uuid,
  add column if not exists strategy_lab_export_id uuid,
  add column if not exists decision_summary text,
  add column if not exists decision_payload jsonb not null default '{}'::jsonb;

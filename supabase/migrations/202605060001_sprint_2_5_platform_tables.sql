create table if not exists public.risk_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kill_switch_enabled boolean not null default false,
  authorized_user_ids text[] not null default '{}',
  restricted_symbols text[] not null default '{}',
  allowed_symbols text[] not null default '{}',
  max_position_size numeric,
  max_notional_exposure numeric,
  max_daily_loss numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.risk_audit_records (
  id uuid primary key,
  user_id uuid not null,
  source text not null,
  broker_id text,
  status text not null check (status in ('allow', 'warn', 'block')),
  summary text not null,
  issue_codes text[] not null default '{}',
  issues jsonb not null default '[]'::jsonb,
  estimated_order_notional numeric not null default 0,
  projected_notional_exposure numeric not null default 0,
  order_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.oms_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  broker_id text not null,
  strategy_id uuid,
  source text not null,
  asset_class text not null,
  instrument_type text not null,
  status text not null,
  estimated_notional numeric not null default 0,
  filled_quantity numeric not null default 0,
  average_fill_price numeric not null default 0,
  legs jsonb not null default '[]'::jsonb,
  instructions jsonb not null default '{}'::jsonb,
  capability_warnings text[] not null default '{}',
  raw_signal jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.oms_executions (
  id uuid primary key default gen_random_uuid(),
  oms_order_id uuid not null references public.oms_orders(id) on delete cascade,
  broker_order_id text,
  leg_id text,
  status text not null,
  filled_quantity numeric not null default 0,
  average_fill_price numeric not null default 0,
  raw_update jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.strategy_automation_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  enabled boolean not null default false,
  interval_minutes integer not null default 15 check (interval_minutes > 0),
  max_signals_per_run integer not null default 1 check (max_signals_per_run > 0),
  min_confidence numeric not null default 0.7 check (min_confidence >= 0 and min_confidence <= 1),
  allowed_symbols text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_id)
);

create table if not exists public.strategy_automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  strategy_id uuid not null,
  status text not null,
  accepted_order_ids uuid[] not null default '{}',
  blocked_order_ids uuid[] not null default '{}',
  audit_record_ids uuid[] not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists risk_audit_records_user_created_idx
  on public.risk_audit_records (user_id, created_at desc);

create index if not exists oms_orders_user_status_created_idx
  on public.oms_orders (user_id, status, created_at desc);

create index if not exists oms_executions_order_occurred_idx
  on public.oms_executions (oms_order_id, occurred_at desc);

create index if not exists strategy_automation_runs_user_strategy_started_idx
  on public.strategy_automation_runs (user_id, strategy_id, started_at desc);

create table public.option_trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  -- Keep the immutable ID after a connection is deleted, so reconciliation fails
  -- closed without preventing the existing broker-disconnection workflow.
  broker_account_id text not null,
  broker_base_url text not null,
  route_scope text not null,
  strategy_id text,
  delivery_key text not null unique,
  original_message text not null,
  underlying text not null,
  symbol text not null,
  expiration date not null,
  strike numeric not null check (strike > 0),
  option_type text not null check (option_type in ('call', 'put')),
  quantity integer not null default 3 check (quantity = 3),
  target_quantity integer not null default 1 check (target_quantity = 1),
  entry_price numeric not null check (entry_price > 0),
  target_price numeric not null check (target_price > entry_price),
  target_time_in_force text not null default 'gtc' check (target_time_in_force = 'gtc'),
  status text not null default 'queued' check (status in (
    'queued', 'entry_submitting', 'entry_pending', 'target_submitting', 'target_pending',
    'entry_terminal', 'first_target_filled', 'needs_attention'
  )),
  entry_attempted_at timestamptz,
  target_attempted_at timestamptz,
  entry_order_id text,
  target_order_id text,
  entry_status text,
  target_status text,
  entry_filled_qty numeric not null default 0,
  target_filled_qty numeric not null default 0,
  last_error text,
  next_check_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.option_trade_plans enable row level security;
revoke all on public.option_trade_plans from anon, authenticated;
grant select on public.option_trade_plans to authenticated;
grant all on public.option_trade_plans to service_role;
create policy option_plans_owner_read on public.option_trade_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create index option_plans_due on public.option_trade_plans(next_check_at)
  where status not in ('entry_terminal', 'first_target_filled', 'needs_attention');

create function public.claim_option_trade_plans(plan_id uuid default null)
returns setof public.option_trade_plans language sql security definer set search_path = public as $$
  with candidates as (
    select id from public.option_trade_plans
    where status not in ('entry_terminal', 'first_target_filled', 'needs_attention')
      and (plan_id is null or id = plan_id)
      and next_check_at <= now()
      and (lease_until is null or lease_until < now())
    order by next_check_at for update skip locked limit 3
  )
  update public.option_trade_plans p
    set lease_until = now() + interval '3 minutes', lease_token = gen_random_uuid()
    from candidates c where p.id = c.id returning p.*;
$$;
revoke all on function public.claim_option_trade_plans(uuid) from public, anon, authenticated;
grant execute on function public.claim_option_trade_plans(uuid) to service_role;

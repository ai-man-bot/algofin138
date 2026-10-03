-- Option actions share their plan's lease; ingress never mutates worker state.
alter table public.option_trade_plans add column management jsonb not null default '{}'::jsonb;
alter table public.option_trade_plans drop constraint option_trade_plans_status_check;
alter table public.option_trade_plans add constraint option_trade_plans_status_check check (status in (
  'queued','entry_submitting','entry_pending','target_submitting','target_pending',
  'entry_terminal','first_target_filled','needs_attention','management_pending','managed','protected','closed'
));

create table public.option_signal_actions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.option_trade_plans(id),
  user_id uuid not null references auth.users(id),
  route_scope text not null,
  symbol text not null,
  delivery_key text not null unique,
  instruction jsonb not null,
  original_message text not null,
  status text not null default 'queued' check(status in ('queued','processing','completed','needs_attention')),
  execution jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.option_signal_actions enable row level security;
revoke all on public.option_signal_actions from anon, authenticated;
grant select on public.option_signal_actions to authenticated;
grant all on public.option_signal_actions to service_role;
create policy option_actions_owner_read on public.option_signal_actions for select to authenticated
  using ((select auth.uid()) = user_id);
create index option_actions_plan on public.option_signal_actions(plan_id, created_at, id);
create index option_actions_pending on public.option_signal_actions(plan_id) where status in ('queued','processing');

create function public.enqueue_option_signal_action(
  p_plan_id uuid, p_user_id uuid, p_scope text, p_key text, p_instruction jsonb, p_message text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.option_trade_plans; a public.option_signal_actions; inserted boolean;
begin
  select * into p from public.option_trade_plans where id=p_plan_id and user_id=p_user_id and route_scope=p_scope for update;
  if p.id is null then raise exception 'No matching owned trade'; end if;
  if p_instruction->>'asset' <> 'option' or p_instruction->>'action' not in ('close_all','target_reached') then
    raise exception 'Unsupported option action';
  end if;
  if p.expiration < (now() at time zone 'America/New_York')::date then raise exception 'Matching trade has expired'; end if;
  -- Preserve cross-action event-ID conflicts, including IDs already used for BTO.
  if exists(select 1 from public.option_trade_plans where delivery_key=p_key) then raise exception 'event_id was already used for an entry'; end if;
  insert into public.option_signal_actions(plan_id,user_id,route_scope,symbol,delivery_key,instruction,original_message)
    values(p.id,p_user_id,p_scope,p.symbol,p_key,p_instruction,p_message)
    on conflict(delivery_key) do nothing returning * into a;
  inserted := a.id is not null;
  if not inserted then
    select * into a from public.option_signal_actions where delivery_key=p_key;
    if a.user_id<>p_user_id or a.plan_id<>p.id or (a.instruction-'gain_percent')<>(p_instruction-'gain_percent') then
      raise exception 'event_id was already used for different instructions';
    end if;
  end if;
  update public.option_trade_plans set next_check_at=least(next_check_at,now()) where id=p.id;
  return jsonb_build_object('action',to_jsonb(a),'duplicate',not inserted);
end $$;
revoke all on function public.enqueue_option_signal_action(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.enqueue_option_signal_action(uuid,uuid,text,text,jsonb,text) to service_role;

-- Pending actions wake completed/attention plans. Only one plan per account and
-- contract can be leased, even when several scopes have the same contract.
create or replace function public.claim_option_trade_plans(plan_id uuid default null)
returns setof public.option_trade_plans language plpgsql security definer set search_path=public as $$
declare candidate public.option_trade_plans; claimed public.option_trade_plans; n integer:=0;
begin
  for candidate in select p.* from public.option_trade_plans p
    where (plan_id is null or p.id=plan_id) and p.next_check_at<=now()
      and (p.lease_until is null or p.lease_until<now())
      and (p.status not in ('entry_terminal','first_target_filled','needs_attention','closed')
        or exists(select 1 from public.option_signal_actions a where a.plan_id=p.id and a.status in ('queued','processing')))
    order by p.next_check_at,p.id for update skip locked
  loop
    if n>=3 then exit; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(candidate.user_id::text||':'||candidate.broker_account_id||':'||candidate.symbol,0)) then continue; end if;
    if exists(select 1 from public.option_trade_plans p where p.id<>candidate.id
      and p.user_id=candidate.user_id and p.broker_account_id=candidate.broker_account_id
      and p.symbol=candidate.symbol and p.lease_until>now()) then continue; end if;
    update public.option_trade_plans set lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid()
      where id=candidate.id returning * into claimed;
    n:=n+1; return next claimed;
  end loop;
end $$;

-- Atomically fence both action and plan writes with the worker lease.
create function public.save_option_action(p_plan_id uuid,p_lease uuid,p_action_id uuid,p_execution jsonb,p_status text,p_error text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.option_trade_plans where id=p_plan_id and lease_token=p_lease and lease_until>now() for update;
  if not found then raise exception 'Option plan lease lost'; end if;
  update public.option_signal_actions set execution=p_execution,status=p_status,last_error=p_error,updated_at=now()
    where id=p_action_id and plan_id=p_plan_id;
  if not found then raise exception 'Action not found'; end if;
end $$;
revoke all on function public.save_option_action(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.save_option_action(uuid,uuid,uuid,jsonb,text,text) to service_role;

-- A provider ID has one meaning across both entry and management tables.
create function public.guard_option_delivery_key() returns trigger language plpgsql set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.delivery_key,1));
  if tg_table_name='option_trade_plans' then
    if exists(select 1 from public.option_signal_actions where delivery_key=new.delivery_key) then
      raise exception 'event_id was already used for a management instruction';
    end if;
  else
    if exists(select 1 from public.option_trade_plans where delivery_key=new.delivery_key) then
      raise exception 'event_id was already used for an entry';
    end if;
  end if;
  return new;
end $$;
create trigger option_entry_delivery_guard before insert on public.option_trade_plans
  for each row execute function public.guard_option_delivery_key();
create trigger option_action_delivery_guard before insert on public.option_signal_actions
  for each row execute function public.guard_option_delivery_key();

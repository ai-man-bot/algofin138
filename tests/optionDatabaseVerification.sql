-- Run via supabase db query --linked --file ... . Every test mutation rolls back.
begin;
do $$
declare test_user uuid; plan_uuid uuid; claimed integer;
begin
  select id into test_user from auth.users order by created_at limit 1;
  if test_user is null then raise exception 'A test user is required'; end if;
  if has_table_privilege('anon', 'public.option_trade_plans', 'SELECT') then
    raise exception 'Anonymous plan reads are allowed';
  end if;
  if has_table_privilege('authenticated', 'public.option_trade_plans', 'INSERT') then
    raise exception 'Authenticated plan writes are allowed';
  end if;
  if has_function_privilege('authenticated', 'public.claim_option_trade_plans(uuid)', 'EXECUTE') then
    raise exception 'Authenticated users can claim plans';
  end if;
  insert into public.option_trade_plans(user_id,broker_account_id,broker_base_url,route_scope,delivery_key,
    original_message,underlying,symbol,expiration,strike,option_type,entry_price,target_price)
  values(test_user,'test:text-id','https://paper-api.alpaca.markets','verification:rollback',
    'verification:rollback:' || gen_random_uuid(), 'rollback verification', 'PLTR','PLTR271015C00150000',
    '2027-10-15',150,'call',1,2) returning id into plan_uuid;
  perform set_config('option_test.plan_id',plan_uuid::text,true);
  perform set_config('request.jwt.claim.sub',test_user::text,true);
  select count(*) into claimed from public.claim_option_trade_plans(plan_uuid);
  if claimed <> 1 then raise exception 'First claim failed'; end if;
  select count(*) into claimed from public.claim_option_trade_plans(plan_uuid);
  if claimed <> 0 then raise exception 'Lease permits a duplicate claim'; end if;
  update public.option_trade_plans set lease_until=now()-interval '1 minute' where id=plan_uuid;
  select count(*) into claimed from public.claim_option_trade_plans(plan_uuid);
  if claimed <> 1 then raise exception 'Expired lease not recoverable'; end if;
  begin
    insert into public.option_trade_plans(user_id,broker_account_id,broker_base_url,route_scope,delivery_key,
      original_message,underlying,symbol,expiration,strike,option_type,entry_price,target_price)
    select user_id,broker_account_id,broker_base_url,route_scope,delivery_key,
      original_message,underlying,symbol,expiration,strike,option_type,entry_price,target_price
    from public.option_trade_plans where id=plan_uuid;
    raise exception 'Duplicate delivery key accepted';
  exception when unique_violation then null;
  end;
end;
$$;
set local role authenticated;
do $$ begin
  if (select count(*) from public.option_trade_plans where id=current_setting('option_test.plan_id')::uuid) <> 1 then
    raise exception 'Owner cannot read own plan';
  end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
do $$ begin
  if (select count(*) from public.option_trade_plans where id=current_setting('option_test.plan_id')::uuid) <> 0 then
    raise exception 'RLS permits another user to read the plan';
  end if;
end $$;
reset role;
rollback;
select 'passed: uniqueness, leases, recovery, permissions, owner RLS; all test mutations rolled back' as result;

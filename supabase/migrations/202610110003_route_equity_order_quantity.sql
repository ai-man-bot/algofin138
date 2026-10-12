-- Route-level default equity order size for signal-driven equity entries.
--
-- Equity BTO-style messages currently parse but return needs_configuration
-- because they carry no quantity. Routes that opt in to auto execution can set
-- a default share quantity here; when it is null, equity messages keep their
-- current behavior. webhook_routes is a pre-existing remote table, so guard
-- on table existence like 202610110001_route_auto_execute.sql.
do $$
begin
  if to_regclass('public.webhook_routes') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'webhook_routes'
      and column_name = 'equity_order_quantity'
  ) then
    alter table public.webhook_routes
      add column equity_order_quantity integer
      check (equity_order_quantity is null or (equity_order_quantity >= 1 and equity_order_quantity <= 100000));
  end if;
end
$$;

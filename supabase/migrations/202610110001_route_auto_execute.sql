-- Route-level opt-in for automatic broker execution of risk-accepted orders.
-- Existing routes keep their current behavior (flag defaults to false), so
-- enabling execution is an explicit per-route decision.
--
-- webhook_routes is a pre-existing remote table that is intentionally not part
-- of the local migration history (see 20260305031704_remote_baseline.sql).
-- Guard on table existence so local/PGlite environments without the remote
-- baseline can apply this migration without failing.
do $$
begin
  if to_regclass('public.webhook_routes') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'webhook_routes'
      and column_name = 'auto_execute'
  ) then
    alter table public.webhook_routes
      add column auto_execute boolean not null default false;
  end if;
end
$$;

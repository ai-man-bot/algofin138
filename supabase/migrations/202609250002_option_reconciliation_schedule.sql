create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Configure Vault secrets option_worker_url and option_worker_secret before activation.
-- The secret must also be set as OPTION_WORKER_SECRET on the Edge Function.
-- No credentials or project-specific URLs are stored in source control.
create function public.invoke_option_reconciliation() returns void
language plpgsql security definer set search_path = public as $$
declare worker_url text; worker_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name = 'option_worker_url' limit 1;
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name = 'option_worker_secret' limit 1;
  if worker_url is null or worker_secret is null then
    raise warning 'Option reconciliation is not configured: missing Vault secrets';
    return;
  end if;
  perform net.http_post(url := worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-option-worker-secret', worker_secret),
    body := '{}'::jsonb, timeout_milliseconds := 90000);
end;
$$;
revoke all on function public.invoke_option_reconciliation() from public, anon, authenticated;
grant execute on function public.invoke_option_reconciliation() to service_role;
select cron.schedule('option-first-target-reconciliation', '* * * * *',
  'select public.invoke_option_reconciliation();');

create function public.option_worker_ready(expected_url text, expected_secret text) returns boolean
language sql security definer set search_path = public as $$
  select exists(select 1 from vault.decrypted_secrets where name = 'option_worker_url' and decrypted_secret = expected_url)
    and exists(select 1 from vault.decrypted_secrets where name = 'option_worker_secret' and decrypted_secret = expected_secret and length(decrypted_secret) > 0)
    and exists(select 1 from cron.job where jobname = 'option-first-target-reconciliation' and active);
$$;
revoke all on function public.option_worker_ready(text, text) from public, anon, authenticated;
grant execute on function public.option_worker_ready(text, text) to service_role;

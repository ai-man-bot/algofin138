create table if not exists public.kv_store_f118884a (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at_kv_store_f118884a()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists kv_store_f118884a_set_updated_at on public.kv_store_f118884a;

create trigger kv_store_f118884a_set_updated_at
before update on public.kv_store_f118884a
for each row
execute function public.set_updated_at_kv_store_f118884a();

alter table public.kv_store_f118884a enable row level security;

drop policy if exists "service_role_full_access_kv_store_f118884a" on public.kv_store_f118884a;

create policy "service_role_full_access_kv_store_f118884a"
on public.kv_store_f118884a
for all
to service_role
using (true)
with check (true);

-- Connected account IDs include values such as alpaca:ACCOUNT_NUMBER.
-- Preserve existing UUID values while supporting the account ID used by routes.
alter table public.webhook_order_request_logs
  alter column broker_account_id type text using broker_account_id::text;

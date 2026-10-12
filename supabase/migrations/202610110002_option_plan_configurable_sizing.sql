-- Configurable option plan sizing.
--
-- The original fixed 3-contract entry / 1-contract first-target policy is now
-- the default rather than a constraint. Quantity ranges are kept conservative
-- and the first target may never exceed the entry quantity. Existing rows
-- (all 3/1) satisfy the new constraints, so this migration is safe to apply
-- while the previous function version is still serving traffic.
alter table public.option_trade_plans
  drop constraint option_trade_plans_quantity_check;
alter table public.option_trade_plans
  add constraint option_trade_plans_quantity_check
  check (quantity between 1 and 1000);

alter table public.option_trade_plans
  drop constraint option_trade_plans_target_quantity_check;
alter table public.option_trade_plans
  add constraint option_trade_plans_target_quantity_check
  check (target_quantity >= 1 and target_quantity <= quantity);

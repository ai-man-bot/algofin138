# Multi-leg options execution: design notes (Phase 4, deferred)

Date: 2026-10-11

## Why deferred

Multi-leg execution is deliberately not part of this release. The single-leg
option pipeline (entry, first target, milestones, stops, close-all) has never
been verified against real paper fills — deployment happened while the market
was closed. Adding multi-leg auto-execution in the same release would stack a
second unverified execution path on top of the first. Release order:

1. Ship this release to staging, verify on paper per
   `docs/paper-verification-runbook.md` (single-leg + route auto-execute).
2. Build multi-leg execution as its own release with its own paper protocol.

## What already exists

- Leg model: `OrderLeg` with option fields, `instrumentType: 'multi_leg_option'`
  (`src/utils/orderLifecycle.ts`).
- Capability gating: `broker_does_not_support_multi_leg_options` warnings via
  `buildAdvancedOrderSupportMatrix` (Alpaca qualifies when `supportsOptions`).
- Strategy templates with legs/premium/max loss/breakeven:
  `buildOptionOrderLegs`, `estimateOptionOrderPremium`
  (`src/utils/optionChain.ts`), rendered in StrategyLab's Options tab.
- Journal-first submission util with client-order-id idempotency
  (`src/utils/omsBrokerSubmission.ts`) — currently restricted to single-leg
  equity.

## Design sketch (verticals first)

1. **Eligibility extension** in `omsBrokerSubmission.ts`: allow
   `instrumentType === 'multi_leg_option'` with exactly 2 option legs
   (vertical: same underlying, same expiration, one call/put family, strikes
   differ), broker capability `supportsMultiLegOptions` required, no other
   warnings. Reject iron condors/calendars/ratios until verticals are proven.
2. **Payload builder**: Alpaca multi-leg order —
   `{ type: 'limit', time_in_force: 'day', order_type?, limit_price: net,`
   ` legs: [{ symbol, ratio_qty: 1, side, position_intent }] }` with a single
   `client_order_id: oms-<id>`. Net limit = sum of leg limit prices signed by
   side; validate net debit > 0 for debit spreads (long leg priced above short)
   and net credit for credit spreads. The net price must come from explicit
   input (ticket review), never be inferred from indicative snapshots.
3. **Signal/ingest shape**: extend `StrategySignal` with optional
   `legs: OrderLeg[]`-compatible intent OR (preferred) a dedicated
   `/option-strategies/preview|submit` route pair mirroring
   `option_ticket_routes.ts`, so multi-leg never rides the single-leg
   signal grammar. Preview resolves both contracts (`assertOptionContract`),
   shows net debit/credit + max loss before submission.
4. **Execution path**: reuse `submitLifecycleOrderToBroker` journal-first
   semantics; per-leg fills reconcile into `oms_executions` with `leg_id`.
   Alpaca reports the multi-leg order as one order — map leg fills from the
   order's `legs[]` quantity/price fields during reconciliation.
5. **Risk model**: for defined-risk verticals, cap risk at the net debit
   (debit spreads) or width minus credit (credit spreads) times multiplier —
   NOT notional of the short leg. Extend the risk engine's notional estimate
   for `multi_leg_option` before enabling any credit strategy.
6. **Rollout**: paper-first, one strategy template (bull call spread), a
   preview-only endpoint behind no flags, then submit on a dedicated paper
   route, then live after the paper protocol passes.

## Sizing note

Entry/first-target sizing for multi-leg plans should reuse the configurable
sizing constraints (migration 202610110002) rather than adding new columns.

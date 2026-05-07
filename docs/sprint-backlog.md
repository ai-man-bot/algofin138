# Sprint Roadmap

Last updated: 2026-05-06

This document converts the current enhancement backlog into a 3-sprint implementation roadmap with estimates, dependencies, and phased delivery targets.

## Planning Assumptions

- Sprint length: 2 weeks
- Estimate unit: engineer-weeks
- Roadmap goal: deliver phase 1 of the highest-value platform improvements, not full enterprise completion of every epic
- Full production-grade completion of all six epics will likely extend beyond Sprint 3

## Epic Sizing Summary

| Epic | Estimate | Notes |
| --- | --- | --- |
| Website performance and data caching | 1.5-2.5 engineer-weeks | Good first sprint candidate because it improves every screen and reduces visible lag immediately |
| Reduce TradingView dependency | 1.0-1.5 engineer-weeks for research and architecture, 3.0-5.0+ for implementation | Treat Sprint 1 as decision-making and prototype planning |
| Options trading support | 4.0-6.0 engineer-weeks | Large feature that depends on broker abstraction, risk controls, and order model maturity |
| Risk engine | 2.0-3.5 engineer-weeks | Should be phased in before more advanced execution features |
| OMS and EMS layer | 3.5-5.0 engineer-weeks | Depends on normalized broker model and core risk validation |
| Broker-agnostic architecture | 3.0-4.5 engineer-weeks | Foundational for options, OMS/EMS, and multi-broker strategy portability |

## Recommended Sprint Sequence

### Sprint 1: Performance and Architecture Foundations

Duration:
2 weeks

Estimated effort:
3.0-4.0 engineer-weeks

Primary outcomes:
- Make tab switching feel near-instant by introducing client-side caching and background refresh
- Establish one shared data-loading pattern instead of each screen fetching independently
- Complete the TradingView replacement research and select the preferred open-source plus Python direction
- Define the broker-normalization target model needed for later sprints

Scope:
- Website performance and data caching
- Reduce TradingView dependency, research phase
- Broker-agnostic architecture, design phase

Implementation targets:
- Add a shared cached data layer around existing API calls in `src/utils/api.tsx`
- Refactor dashboard, trades, analytics, performance, brokers, webhooks, and notifications to reuse cached responses and background refresh behavior
- Add request status instrumentation so slow endpoints are visible
- Document a recommended open-source replacement stack for research, backtesting, and signal generation
- Decide whether Python strategy execution will run as a separate service, scheduled worker, or broker-side integration helper
- Define normalized platform models for account, position, order, execution, and broker capability flags

Suggested deliverables:
- Cached tab switching for major screens
- Shared stale-while-revalidate loading behavior
- Reduced duplicate fetches on navigation
- Architecture decision record for post-TradingView strategy stack
- Broker-domain model spec for Sprint 2 implementation

Dependencies:
- None for caching work
- Research decision is a dependency for later TradingView replacement implementation
- Broker-domain model design is a dependency for Sprint 2 broker abstraction work

Exit criteria:
- Switching between major tabs no longer triggers a full blocking reload experience
- Cached data remains visible while refresh happens in the background
- A selected open-source strategy research and backtesting direction is documented
- Normalized broker entities are defined and approved for implementation

Risks:
- Existing components fetch directly and inconsistently, so the first pass may uncover duplicate data paths
- Backend endpoints may not return enough metadata for safe cache invalidation

### Sprint 2: Broker Abstraction and Risk Controls

Duration:
2 weeks

Estimated effort:
4.0-5.0 engineer-weeks

Primary outcomes:
- Remove Alpaca-centric assumptions from the internal domain model
- Introduce a platform-level broker abstraction layer
- Add pre-trade risk enforcement before orders leave the system

Scope:
- Broker-agnostic architecture, implementation phase 1
- Risk engine, implementation phase 1

Implementation targets:
- Create normalized types and adapters for account, position, order, execution, and capability metadata
- Refactor dashboard and trade-loading paths so they consume normalized broker data rather than Alpaca-specific shapes
- Implement risk validation hooks for max position size, notional exposure, daily loss, duplicate orders, restricted symbols, authorized-user checks, and account kill switch
- Add platform audit records for blocked and submitted orders
- Introduce admin-visible risk configuration storage and enforcement flow

Suggested deliverables:
- Internal broker abstraction used by the core read paths
- Alpaca adapter moved behind normalized interfaces
- Risk checks executed before order submission
- Kill switch and duplicate-order prevention available in the platform
- Audit visibility for risk decisions and order submission outcomes

Dependencies:
- Depends on Sprint 1 broker-domain model design
- Benefits from Sprint 1 shared data layer because normalized broker reads will be reused across screens
- Must complete before OMS/EMS and options work can safely scale

Exit criteria:
- Core UI screens no longer require Alpaca-specific data assumptions to render
- Orders can be blocked by configurable risk rules before submission
- Platform has an account-wide kill switch and restricted-symbol protection
- Risk decisions are visible in logs or admin-facing audit views

Risks:
- Existing backend routes may need reshaping before adapters can be clean
- Some broker features will not normalize perfectly and may require explicit capability flags

### Sprint 3: OMS/EMS and Options Phase 1

Duration:
2-3 weeks

Estimated effort:
5.0-6.5 engineer-weeks

Primary outcomes:
- Add a first-class order lifecycle layer instead of relying only on webhook-triggered execution
- Enable phase-1 options support
- Start moving strategy execution away from TradingView where feasible

Scope:
- OMS and EMS layer, implementation phase 1
- Options trading support, implementation phase 1
- Reduce TradingView dependency, prototype implementation phase

Implementation targets:
- Introduce a normalized order lifecycle model with support for advanced order instructions
- Add brackets/OCO, trailing stops, GTD/IOC/FOK request modeling, partial-fill handling, and order reconciliation
- Extend strategy and trade models to support options instruments and multi-leg metadata
- Deliver phase-1 options workflows, likely starting with single-leg options plus one limited multi-leg strategy type such as vertical spreads
- Build a Python strategy runner proof of concept using the Sprint 1 selected data and backtesting stack
- Connect generated signals into the existing platform order-routing and risk-validation path

Suggested deliverables:
- OMS/EMS core order model and reconciliation flow
- Advanced order support matrix by broker capability
- Options-aware strategy and trade data model
- Basic options order-entry and analytics support
- Python research and signal-generation proof of concept replacing part of the TradingView workflow

Dependencies:
- Depends on Sprint 2 broker abstraction
- Depends on Sprint 2 risk engine, because advanced order flows and options should not bypass controls
- Depends on Sprint 1 TradingView replacement decision

Exit criteria:
- Order lifecycle supports more than simple webhook-triggered execution
- Platform can represent and track at least a limited set of options trades
- Partial fills and order reconciliation are handled in the internal model
- A Python-based strategy prototype can generate signals into the platform

Risks:
- Options support may expand quickly if contract metadata, pricing, greeks, or multi-leg execution are pulled in too early
- Broker-specific advanced order support will vary and should be feature-flagged

## Dependency Map

### Hard dependencies

- Broker-agnostic architecture must start before OMS/EMS and options work
- Risk engine must be in place before advanced order routing and options execution
- TradingView replacement research decision must happen before Python strategy execution implementation

### Soft dependencies

- Shared caching is not required for broker abstraction, but it reduces UI churn while backend models are changing
- OMS/EMS can begin with one broker adapter first, but the internal order model should still be broker-neutral from day one

## Backlog to Sprint Mapping

| Backlog item | Sprint placement | Reason |
| --- | --- | --- |
| 1. Website performance and data caching | Sprint 1 | Immediate user-visible value and lowest structural risk |
| 2. Reduce TradingView dependency | Sprint 1 research, Sprint 3 prototype | Needs architecture decision before implementation |
| 3. Options trading support | Sprint 3 | Depends on broker abstraction, risk controls, and order lifecycle |
| 4. Risk engine | Sprint 2 | Foundational control layer needed before more advanced execution |
| 5. OMS and EMS layer | Sprint 3 | Depends on normalized broker and risk foundations |
| 6. Broker-agnostic architecture | Sprint 1 design, Sprint 2 implementation | Foundational abstraction needed by several later epics |

## Recommended Team Focus Per Sprint

### Sprint 1 split

- Frontend focus: shared caching, background refresh, loading-state cleanup
- Platform focus: TradingView replacement evaluation and broker-domain model design

### Sprint 2 split

- Backend/platform focus: normalized broker adapters and risk enforcement
- Frontend focus: migrate dashboard, trades, and analytics views to normalized reads

### Sprint 3 split

- Execution focus: OMS/EMS order lifecycle and reconciliation
- Quant/platform focus: options model plus Python strategy runner prototype

## Recommendation

If the team is small, Sprint 3 should be treated as a controlled phase-1 delivery, not full options plus full OMS parity across all brokers. The safest path is:

1. Finish caching and platform decisions first
2. Build broker abstraction and risk controls second
3. Deliver limited OMS/EMS plus limited options support on top of those foundations

## Sprint 1 Implementation Status

Status as of 2026-05-06:

- Shared request cache exists in `src/utils/requestCache.ts` with stale-while-revalidate behavior, in-flight request deduplication, invalidation, request status snapshots, and status subscriptions.
- Cacheable read APIs in `src/utils/api.ts` use the shared cache so tab switches can reuse recent data while background refreshes update stale entries.
- Mutating APIs invalidate related cache prefixes after successful create, update, delete, sync, and confirmation operations.
- `App.tsx` keeps authenticated screens mounted after first visit, preserving screen state while users switch tabs.
- TradingView replacement decision is documented in `docs/adr-001-tradingview-replacement-stack.md`.
- Broker-domain target model for Sprint 2 is documented in `docs/broker-domain-model-spec.md`.

## Sprint 2 Implementation Status

Status as of 2026-05-06:

- Normalized broker snapshots are available through `normalizeBrokerSnapshot` in `src/utils/brokerModels.ts`.
- The frontend API exposes `platformBrokerAPI` in `src/utils/api.ts` so dashboard and trades read paths can consume normalized broker connections, accounts, positions, orders, and open orders.
- Dashboard and Trades tab primary broker-loading paths now use the normalized platform broker facade instead of directly binding to Alpaca response shapes.
- Risk evaluation now blocks unauthorized users, unsupported asset classes by broker capability, insufficient buying power, kill switch, restricted symbols, and allowlist violations.
- Risk audit records can be generated with `createRiskAuditRecord` in `src/utils/riskEngine.ts`.
- Trade Assistant confirmation now evaluates risk before submitting to Alpaca and returns a risk block response before order submission when controls fail.

Remaining Sprint 2 hardening:

- Add durable database migrations or table setup for `risk_settings` and `risk_audit_records` in the linked Supabase project.
- Move webhook and strategy-triggered order paths through the same shared risk gate used by Trade Assistant.
- Add an admin-facing risk settings/audit UI so users can configure kill switch, authorized users, allowlists, restricted symbols, and view risk decisions.

## Sprint 3 Implementation Status

Status as of 2026-05-06:

- Phase-1 OMS/EMS order lifecycle utilities exist in `src/utils/orderLifecycle.ts`.
- The order lifecycle model can represent normalized order legs, advanced instructions, lifecycle events, accepted/rejected states, partial fills, filled orders, cancellations, and reconciliation updates.
- Phase-1 options modeling supports OCC-style single-leg symbols plus limited multi-leg option orders such as vertical spreads.
- Advanced-order capability checks now produce a broker support matrix for options, multi-leg options, OCO/bracket orders, trailing stops, GTD, IOC, and FOK instructions.
- Python strategy runner signal intents can be converted into platform lifecycle orders and routed through the existing risk engine before being accepted.
- Risk audit records are generated for Python-generated signals, including blocked unsupported options orders.

Remaining Sprint 3 hardening:

- Persist OMS lifecycle orders, executions, and reconciliation events in Supabase tables instead of keeping the current implementation as frontend/platform utilities.
- Add backend routes so webhook, Trade Assistant, manual, and Python strategy orders all use the same lifecycle service.
- Wire real broker reconciliation polling/webhooks into `reconcileOrderLifecycle`.
- Add UI for advanced order entry, options order review, lifecycle status, and broker capability warnings.
- Expand options metadata to include contract lookup, pricing, greeks, expiration chains, and broader multi-leg strategy templates.
- Build and deploy the actual Python worker/service; the current implementation defines the platform ingestion contract and risk-gated lifecycle conversion.

## Five-Sprint Completion Status

The original in-repo roadmap above directly defined Sprints 1-3. Sprints 4-5 below are inferred extensions from the earlier five-sprint planning discussion and are documented separately so future planning can distinguish confirmed backlog artifacts from extrapolated scope.

### Sprint 1: Performance and Architecture Foundations

Completion status as of 2026-05-06:

- Shared request caching and stale-while-revalidate behavior are implemented in `src/utils/requestCache.ts`.
- Cacheable API read paths use shared caching through `src/utils/api.ts`.
- Authenticated tab content remains mounted after first visit to reduce repeat loading on navigation.
- TradingView replacement direction is documented in `docs/adr-001-tradingview-replacement-stack.md`.
- Broker domain model target is documented in `docs/broker-domain-model-spec.md`.

### Sprint 2: Broker Abstraction and Risk Controls

Completion status as of 2026-05-06:

- Normalized broker account, position, order, connection, and capability models exist in `src/utils/brokerModels.ts`.
- Dashboard and Trades primary broker-loading paths consume the normalized broker facade.
- Risk evaluation exists in `src/utils/riskEngine.ts` and covers authorization, kill switch, unsupported asset classes, buying power, duplicate orders, symbol restrictions, allowlists, daily-loss warnings, position caps, and exposure caps.
- Durable Supabase table definitions for `risk_settings` and `risk_audit_records` are defined in `supabase/migrations/202605060001_sprint_2_5_platform_tables.sql`.

### Sprint 3: OMS/EMS and Options Phase 1

Completion status as of 2026-05-06:

- Normalized OMS/EMS lifecycle utilities exist in `src/utils/orderLifecycle.ts`.
- Lifecycle orders support normalized legs, advanced instructions, lifecycle events, accepted/rejected states, partial fills, filled orders, cancellations, and reconciliation updates.
- Phase-1 options modeling supports OCC-style option symbols and limited multi-leg options such as vertical spreads.
- Broker capability checks cover options, multi-leg options, OCO/brackets, trailing stops, GTD, IOC, and FOK.
- Durable Supabase table definitions for `oms_orders` and `oms_executions` are defined in `supabase/migrations/202605060001_sprint_2_5_platform_tables.sql`.

### Sprint 4: Trade Assistant and Strategy Automation

Completion status as of 2026-05-06:

- Trade Assistant parsing and confirmation routes already exist in `src/supabase/functions/server/trade_assistant_routes.ts`.
- A shared platform risk gate now exists in `src/utils/riskGate.ts` so webhook, manual, Trade Assistant, and Python-generated intents can use one normalized validation path.
- Strategy automation scheduling, executable-signal filtering, and run-plan generation exist in `src/utils/strategyAutomation.ts`.
- Python strategy runner signals can be selected by interval, confidence, allowlist, and max-per-run rules, then routed through the shared risk gate.
- Frontend API contracts for platform order routing and strategy automation are exposed from `src/utils/api.ts`.
- Durable Supabase table definitions for `strategy_automation_schedules` and `strategy_automation_runs` are defined in `supabase/migrations/202605060001_sprint_2_5_platform_tables.sql`.

### Sprint 5: Production Readiness and Scale

Completion status as of 2026-05-06:

- Production readiness checks exist in `src/utils/productionReadiness.ts`.
- Readiness evaluation covers required environment variables, database migrations/tables, API routes, and verification command outcomes.
- The readiness utility reports blockers, warnings, passed checks, and a concise status summary.
- The platform tables migration adds indexes for risk audits, OMS orders, OMS executions, and automation runs.
- Regression tests now cover caching, broker normalization, risk controls, OMS/options lifecycle, shared risk routing, strategy automation, and production readiness.

### Remaining Beyond-Sprint Hardening

- Apply the new Supabase migration to the linked project with `npm run supabase:db:push`.
- Implement server endpoints behind the new frontend API contracts: `/platform-orders/route`, `/platform-orders/:id/reconcile`, `/strategy-automation/schedules`, and `/strategy-automation/run`.
- Move the legacy public webhook execution path through `routeOrderIntentThroughRiskGate` before broker submission.
- Deploy a real Python worker/service for scheduled research and signal generation; the current implementation covers the TypeScript ingestion, filtering, and risk-gated routing contract.
- Add UI screens for risk configuration, risk audit review, OMS lifecycle status, strategy automation schedules, and production readiness status.

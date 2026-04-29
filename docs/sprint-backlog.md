# Sprint Roadmap

Last updated: 2026-04-24

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

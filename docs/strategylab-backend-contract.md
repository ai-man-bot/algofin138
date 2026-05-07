# StrategyLab Backend Contract

Date: 2026-05-07

## Scope

This backend slice turns the standalone StrategyLab prototype into Algofin platform APIs. The HTML prototype remains a reference for workflows only; production code uses typed backend modules, Supabase persistence, Alpaca market data, and the existing AlgoFin webhook/risk/OMS path.

## API Surface

All routes live under the existing `webhook-listener` Supabase Edge Function:

- `GET /strategy-lab/market/quote?symbol=AAPL`
- `GET /strategy-lab/market/bars?symbol=AAPL&timeframe=1D&period=2y`
- `POST /strategy-lab/strategies`
- `PUT /strategy-lab/strategies/:id`
- `POST /strategy-lab/strategies/:id/pinescript`
- `POST /strategy-lab/backtests`
- `GET /strategy-lab/backtests/:jobId`
- `POST /strategy-lab/optimizations`
- `GET /strategy-lab/optimizations/:jobId`
- `POST /strategy-lab/exports/algofin`

## Data Flow

Market data uses Alpaca first. The provider boundary is isolated in `src/utils/strategyLabMarketData.ts`, so Yahoo, Polygon, or a future Python/vectorbt worker can be added without changing the frontend API wrapper.

Backtests and optimizations run synchronously for v1 and persist their completed job rows. Large-grid distributed compute is intentionally deferred until the API and database contracts are stable.

AlgoFin export creates or links a normal webhook route, persists a `strategy_lab_exports` row, generates PineScript v5, and embeds alert JSON with `route_token`, `strategy_id`, `symbol`, `side`, `quantity`, `price`, and `source: "strategylab_pinescript"`. Downstream execution continues through the existing webhook receiver, which now converts supported non-UI signals into shared OMS plus risk-audit records instead of treating StrategyLab export as a direct broker submission path.

## Verification Status

- Local verification passed on 2026-05-07 with `npm test` and `npm run build`.
- Remote migration `202605070001_strategy_lab_backend.sql` was applied to Supabase project `dzboqhobrmzglyuofcyk`.
- Live verification passed on 2026-05-07 against the deployed `webhook-listener` function for quote fetch, bars fetch, strategy save, backtest, optimization, PineScript generation, AlgoFin export, and webhook-to-OMS/risk routing.

## Remaining Follow-Through

- Align or retire the older `mligzafrdckazvagqeht` Supabase project references if that environment is no longer used.
- Replace the temporary live-check auth workflow with a stable seeded verification user or scripted environment-level Alpaca credentials for future smoke tests.

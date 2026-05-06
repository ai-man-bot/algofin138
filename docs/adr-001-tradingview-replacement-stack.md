# ADR 001: TradingView Replacement Stack

Date: 2026-05-06

## Status

Accepted for Sprint 1 architecture foundation.

## Context

AlgoFin currently accepts TradingView-style webhook signals and routes them into broker execution. This works for alert-driven workflows, but it leaves strategy research, backtesting, signal generation, and order intent parsing outside the platform. Sprint 1 needs a selected direction so Sprint 3 can prototype Python-generated signals without coupling the product to TradingView alert syntax.

## Decision

Use a Python-first strategy research and signal-generation service as the long-term replacement path.

Recommended stack:

- `pandas` and `numpy` for time-series feature engineering and signal transforms.
- `vectorbt` for fast strategy research, parameter sweeps, and portfolio-level backtests.
- `backtrader` as the compatibility option when event-driven simulation or broker-like order lifecycle behavior is needed.
- Platform-generated webhook/order-intent payloads as the integration contract into the existing Supabase API.
- Alpaca market data as the initial live/paper data source, with a provider interface so Polygon, Tiingo, or broker-specific feeds can be added later.

The first production slice should run as a separate Python worker or service, not inside the React app or Supabase Edge Function. Supabase should remain the API/orchestration boundary; Python should own research, scheduled signal generation, and backtest jobs.

## Rationale

This keeps latency-sensitive UI work separate from compute-heavy research jobs. It also lets the platform evolve from TradingView alerts to first-party signals without immediately rebuilding the OMS/EMS layer. `vectorbt` gives fast iteration for strategy research, while `backtrader` remains available for event-driven cases that require more realistic order sequencing.

## Integration Contract

Python strategy jobs should emit normalized signal intents:

```json
{
  "strategyId": "strategy-uuid",
  "symbol": "AAPL",
  "assetClass": "equity",
  "side": "buy",
  "quantity": 10,
  "orderType": "market",
  "timeInForce": "day",
  "signalSource": "python-strategy-runner",
  "generatedAt": "2026-05-06T12:00:00Z",
  "metadata": {
    "model": "momentum-v1",
    "confidence": 0.72
  }
}
```

The API should route these intents through the same validation path as webhook and Trade Assistant orders: auth, strategy lookup, risk checks, broker capability checks, execution, and audit recording.

## Consequences

TradingView remains supported as an external signal source during migration. Sprint 3 can prototype Python signals without changing the user-facing strategy pages first. Future OMS/EMS work should consume the same normalized order intent shape regardless of whether the source is TradingView, Python, manual entry, or Trade Assistant.

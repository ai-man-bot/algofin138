# Python Strategy Runner (reference implementation)

Standalone strategy research and signal-generation worker following
[ADR-001](../docs/adr-001-tradingview-replacement-stack.md). It replaces the
TradingView alert hop: the runner computes signals locally and submits them to
the platform's strategy automation endpoint, which enforces schedule rules,
runs the shared risk gate, persists OMS orders plus audit records, and only
submits to the broker when the run explicitly opts in.

## Safety model

- `auto_execute` defaults to **false**: runs validate and record orders but
  never submit to the broker.
- Every run passes through the schedule you saved in Operations (enabled,
  interval, minimum confidence, allowed symbols, max signals per run).
- The risk gate (kill switch, buying power, exposure caps, symbol rules) can
  still block each signal individually.
- Start on a paper account. Only set `auto_execute: true` after the paper
  verification runbook (`docs/paper-verification-runbook.md`) passes.

## Setup

```bash
# 1. Save a schedule in Operations > Automation for your strategy and enable it.
# 2. Get an access token following src/HOW_TO_GET_ACCESS_TOKEN.md.
# 3. Configure the runner:
cp config.example.json config.json   # then edit values; never commit config.json
# 4. Run:
python strategy_runner.py
```

Schedule it with cron, Windows Task Scheduler, or the loop flag:

```bash
python strategy_runner.py --loop   # sleeps for interval_minutes between runs
```

## What it does

1. Fetches daily bars for each configured symbol through the platform's
   market-data route (`/strategy-lab/market/bars`) using your access token.
2. Computes a 14-period RSI and emits a **buy** signal when RSI crosses up
   through the oversold threshold (the same entry condition the StrategyLab
   backtest engine uses).
3. Derives a confidence score from the RSI margin and attaches a **stable
   signal id** (hash of strategy, symbol, and the triggering bar time), so a
   rerun over the same bars is naturally self-identifying.
4. POSTs the signals to `/strategy-automation/run` with
   `auto_execute` from the config (default false) and prints the run result,
   including blocked orders and their risk-decision reasons.

The signal shape is the ADR-001 normalized intent; the platform's ingestion
contract:

```json
{
  "strategy_id": "your-strategy-uuid",
  "broker_id": "optional-explicit-alpaca-account-id",
  "auto_execute": false,
  "signals": [
    {
      "id": "stable-signal-id",
      "symbol": "AAPL",
      "side": "buy",
      "quantity": 10,
      "orderType": "market",
      "metadata": { "confidence": 0.8, "model": "rsi-oversold-v1" }
    }
  ]
}
```

## Extending it

- Replace `compute_rsi` / `generate_signals` with your own model (pandas,
  vectorbt, backtrader) — only the emitted signal shape is the contract.
- Emit `limit` orders by adding `limitPrice`; the platform supports
  market/limit/stop/stop_limit with day/gtc/ioc/fok.
- Run `--loop` under a process manager (systemd, NSSM) for unattended
  scheduling; the platform's interval gate ignores runs that are too frequent.

## Production notes

- Keep `config.json` and access tokens out of git.
- The access token is a Supabase JWT: rotate it if it leaks, and prefer a
  long-lived token from a dedicated service account rather than your own
  session token.
- This runner never talks to Alpaca directly; all execution decisions stay
  inside the platform's risk-gated path.

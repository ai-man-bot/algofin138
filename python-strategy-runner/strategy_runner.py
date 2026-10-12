#!/usr/bin/env python3
"""AlgoFin Python strategy runner: ADR-001 signal intents into the platform.

Computes RSI-oversold entry signals from the platform's market-data route and
submits them to /strategy-automation/run. The platform enforces schedule rules
and the shared risk gate; broker submission happens only when the config sets
auto_execute (default false). Start with a paper account and follow
docs/paper-verification-runbook.md before enabling execution.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MODEL_NAME = "rsi-oversold-v1"


def load_config(path: str) -> dict:
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    required = ["base_url", "access_token", "strategy_id", "symbols"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise SystemExit(f"config.json is missing: {', '.join(missing)}")
    if not isinstance(config["symbols"], list) or not config["symbols"]:
        raise SystemExit("config.json symbols must be a nonempty list")
    return config


def http_json(request: urllib.request.Request, timeout: float = 30.0) -> dict:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_bars(config: dict, symbol: str) -> list[dict]:
    url = (
        f"{config['base_url'].rstrip('/')}/strategy-lab/market/bars"
        f"?symbol={urllib.request.quote(symbol)}"
        f"&timeframe={urllib.request.quote(str(config.get('bars_timeframe', '1D')))}"
        f"&period={urllib.request.quote(str(config.get('bars_period', '1y')))}"
    )
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {config['access_token']}",
        "Content-Type": "application/json",
    })
    data = http_json(request)
    bars = data.get("bars") if isinstance(data, dict) else data
    if not isinstance(bars, list):
        raise RuntimeError(f"Unexpected bars response for {symbol}: {data!r}")
    return bars


def compute_rsi(closes: list[float], length: int) -> list[float | None]:
    """Wilder RSI, mirroring src/utils/backtestEngine.ts."""
    rsi: list[float | None] = [None] * len(closes)
    if len(closes) <= length:
        return rsi
    gains = losses = 0.0
    for index in range(1, length + 1):
        delta = closes[index] - closes[index - 1]
        gains += max(delta, 0.0)
        losses += max(-delta, 0.0)
    average_gain = gains / length
    average_loss = losses / length
    rsi[length] = 100.0 if average_loss == 0 else 100.0 - 100.0 / (1.0 + average_gain / average_loss)
    for index in range(length + 1, len(closes)):
        delta = closes[index] - closes[index - 1]
        average_gain = (average_gain * (length - 1) + max(delta, 0.0)) / length
        average_loss = (average_loss * (length - 1) + max(-delta, 0.0)) / length
        rsi[index] = 100.0 if average_loss == 0 else 100.0 - 100.0 / (1.0 + average_gain / average_loss)
    return rsi


def stable_signal_id(strategy_id: str, symbol: str, trigger_time: str) -> str:
    digest = hashlib.sha256(f"{strategy_id}:{symbol}:{trigger_time}".encode()).hexdigest()
    return f"py-{digest[:32]}"


def generate_signals(config: dict) -> list[dict]:
    length = int(config.get("rsi_length", 14))
    oversold = float(config.get("rsi_oversold", 30))
    signals: list[dict] = []
    for symbol in config["symbols"]:
        bars = fetch_bars(config, symbol)
        closes = [float(bar["close"]) for bar in bars if bar.get("close") is not None]
        rsi = compute_rsi(closes, length)
        if len(closes) < length + 2:
            print(f"  {symbol}: not enough bars ({len(closes)}); skipped")
            continue
        previous, current = rsi[-2], rsi[-1]
        if previous is None or current is None:
            print(f"  {symbol}: RSI undefined; skipped")
            continue
        if not (previous < oversold <= current):
            print(f"  {symbol}: no RSI oversold cross (prev {previous:.1f} -> {current:.1f})")
            continue
        # Confidence grows with the distance between the cross point and the
        # oversold threshold, capped at 1.0. The schedule's minimum confidence
        # gate can still filter it out on the platform side.
        confidence = min(1.0, 0.7 + (current - oversold) / 100.0)
        signals.append({
            "id": stable_signal_id(config["strategy_id"], symbol, str(bars[-1].get("time", ""))),
            "symbol": symbol,
            "side": "buy",
            "quantity": float(config.get("quantity", 1)),
            "orderType": str(config.get("order_type", "market")),
            "metadata": {"confidence": confidence, "model": MODEL_NAME},
        })
        print(f"  {symbol}: RSI oversold cross (prev {previous:.1f} -> {current:.1f}), confidence {confidence:.2f}")
    return signals


def run_once(config: dict) -> dict:
    signals = generate_signals(config)
    payload = {
        "strategy_id": config["strategy_id"],
        "auto_execute": bool(config.get("auto_execute", False)),
        "signals": signals,
    }
    if config.get("broker_id"):
        payload["broker_id"] = config["broker_id"]
    request = urllib.request.Request(
        f"{config['base_url'].rstrip('/')}/strategy-automation/run",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['access_token']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    result = http_json(request)
    run = result.get("run") or {}
    print(f"Run status: {run.get('status', 'unknown')}")
    if result.get("plan"):
        accepted = result["plan"].get("accepted_order_ids", [])
        blocked = result["plan"].get("blocked_order_ids", [])
        print(f"Accepted orders: {len(accepted)}; blocked by risk: {len(blocked)}")
        for signal_id, submission in (result["plan"].get("submissions") or {}).items():
            print(f"  {signal_id}: {submission.get('status')}{' — ' + str(submission.get('reason', submission.get('error', ''))) if submission.get('reason') or submission.get('error') else ''}")
    if result.get("error"):
        print(f"Run error: {result['error']}")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="AlgoFin Python strategy runner")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--loop", action="store_true", help="keep running on the configured interval")
    args = parser.parse_args()

    config = load_config(args.config)
    interval = max(1, int(config.get("interval_minutes", 60)))
    print(f"Strategy {config['strategy_id']} over {', '.join(config['symbols'])}; auto_execute={bool(config.get('auto_execute', False))}")

    while True:
        try:
            run_once(config)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")
            print(f"HTTP {error.code} from platform: {body}", file=sys.stderr)
            if not args.loop:
                return 1
        except Exception as error:  # noqa: BLE001 - loop must survive transient failures
            print(f"Run failed: {error}", file=sys.stderr)
            if not args.loop:
                return 1
        if not args.loop:
            return 0
        time.sleep(interval * 60)


if __name__ == "__main__":
    raise SystemExit(main())

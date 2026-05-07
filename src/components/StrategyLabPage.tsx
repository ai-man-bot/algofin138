import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Copy, RefreshCw, Settings, TrendingUp, Zap } from './CustomIcons';
import { strategyLabAPI } from '../utils/api';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type LabStrategyRow = {
  id: string;
  name: string;
  symbol: string;
  generated_pinescript?: string;
};

type LabQuote = {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  source: string;
  timestamp: string;
};

const fieldClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500';

const labelClass = 'mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500';

const defaultRanges = {
  rsiLength: { min: 10, max: 20, step: 2 },
  stopLossPct: { min: 2, max: 6, step: 1 },
  takeProfitPct: { min: 5, max: 12, step: 1 },
};

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function MetricTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'bad' | 'accent' }) {
  const color = tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : tone === 'accent' ? 'text-blue-300' : 'text-slate-100';

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 p-4">
      <p className="mb-2 text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`font-mono text-xl ${color}`}>{value}</p>
    </div>
  );
}

export function StrategyLabPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [strategyName, setStrategyName] = useState('RSI Momentum');
  const [rsiLength, setRsiLength] = useState('14');
  const [emaShort, setEmaShort] = useState('20');
  const [emaLong, setEmaLong] = useState('50');
  const [stopLossPct, setStopLossPct] = useState('3');
  const [takeProfitPct, setTakeProfitPct] = useState('8');
  const [positionSize, setPositionSize] = useState('5');
  const [routeToken, setRouteToken] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [savedStrategy, setSavedStrategy] = useState<LabStrategyRow | null>(null);
  const [quote, setQuote] = useState<LabQuote | null>(null);
  const [barsLoaded, setBarsLoaded] = useState(0);
  const [backtest, setBacktest] = useState<any | null>(null);
  const [optimization, setOptimization] = useState<any | null>(null);
  const [pineScript, setPineScript] = useState('');
  const [exportRoute, setExportRoute] = useState<any | null>(null);

  const strategyPayload = useMemo(() => ({
    name: strategyName,
    symbol,
    assetClass: 'equity',
    direction: 'long',
    indicators: {
      rsiLength: safeNumber(rsiLength, 14),
      emaShort: safeNumber(emaShort, 20),
      emaLong: safeNumber(emaLong, 50),
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
    },
    entryRules: [
      { indicator: 'RSI', operator: 'crosses_below', value: 30 },
      { indicator: 'MACD', operator: 'crosses_above_signal' },
      { indicator: 'price', operator: 'above_ema_short' },
    ],
    exitRules: [
      { indicator: 'RSI', operator: 'crosses_above', value: 70 },
    ],
    risk: {
      stopLossPct: safeNumber(stopLossPct, 3),
      takeProfitPct: safeNumber(takeProfitPct, 8),
      trailingStopPct: 1.5,
    },
    positionSizing: {
      type: 'percent_of_equity',
      value: safeNumber(positionSize, 5),
    },
    metadata: {
      ui: 'algofin-strategy-lab',
    },
  }), [emaLong, emaShort, positionSize, rsiLength, stopLossPct, strategyName, symbol, takeProfitPct]);

  const runAction = async (name: string, action: () => Promise<void>) => {
    setLoadingAction(name);
    setError('');
    setStatus('');

    try {
      await action();
    } catch (err: any) {
      setError(err?.message || 'StrategyLab request failed');
    } finally {
      setLoadingAction(null);
    }
  };

  const loadMarketData = () => runAction('market', async () => {
    const [quoteResult, barsResult] = await Promise.all([
      strategyLabAPI.getQuote(symbol, { forceRefresh: true }),
      strategyLabAPI.getBars(symbol, { timeframe: '1D', period: '2y', limit: 1000 }, { forceRefresh: true }),
    ]);
    setQuote(quoteResult.quote);
    setBarsLoaded(Array.isArray(barsResult.bars) ? barsResult.bars.length : 0);
    setStatus(`Loaded ${quoteResult.quote?.symbol || symbol} market data from Alpaca.`);
  });

  const saveStrategy = () => runAction('save', async () => {
    const result = savedStrategy
      ? await strategyLabAPI.updateStrategy(savedStrategy.id, strategyPayload)
      : await strategyLabAPI.createStrategy(strategyPayload);
    setSavedStrategy(result.strategy);
    setStatus(savedStrategy ? 'StrategyLab definition updated.' : 'StrategyLab definition created.');
  });

  const ensureStrategyId = async () => {
    if (savedStrategy?.id) return savedStrategy.id;
    const result = await strategyLabAPI.createStrategy(strategyPayload);
    setSavedStrategy(result.strategy);
    return result.strategy.id;
  };

  const runBacktest = () => runAction('backtest', async () => {
    const strategyId = await ensureStrategyId();
    const result = await strategyLabAPI.runBacktest({
      strategyId,
      symbol,
      timeframe: '1D',
      period: '2y',
      initialCapital: 10000,
      commissionBps: 0,
    });
    setBacktest(result.results);
    setStatus('Backtest completed and saved.');
  });

  const runOptimization = () => runAction('optimizer', async () => {
    const strategyId = await ensureStrategyId();
    const result = await strategyLabAPI.runOptimization({
      strategyId,
      symbol,
      timeframe: '1D',
      period: '2y',
      targetMetric: 'sharpe',
      ranges: defaultRanges,
      maxCombinations: 500,
    });
    setOptimization(result.results);
    setStatus('Optimizer completed and saved.');
  });

  const generatePine = () => runAction('pine', async () => {
    const strategyId = await ensureStrategyId();
    if (!routeToken.trim()) {
      throw new Error('Enter a webhook route token or use Export to AlgoFin to create one.');
    }

    const result = await strategyLabAPI.generatePineScript(strategyId, { routeToken: routeToken.trim() });
    setPineScript(result.code);
    setStatus('PineScript generated with AlgoFin alert payloads.');
  });

  const exportToAlgoFin = () => runAction('export', async () => {
    const strategyId = await ensureStrategyId();
    const result = await strategyLabAPI.exportToAlgoFin({ strategyId, mode: 'paper' });
    setExportRoute(result.route);
    setPineScript(result.pinescript);
    setRouteToken(result.route?.token || '');
    setStatus('Strategy exported to AlgoFin webhook routing.');
  });

  const copyPine = async () => {
    if (!pineScript) return;
    await navigator.clipboard.writeText(pineScript);
    setStatus('PineScript copied to clipboard.');
  };

  const metrics = backtest?.metrics;
  const topResults = Array.isArray(optimization?.results) ? optimization.results.slice(0, 8) : [];

  return (
    <div className="min-h-[calc(100vh-73px)] bg-[#0f172a] px-6 py-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-100">StrategyLab</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Build, test, optimize, and export AlgoFin-ready strategies using the backend StrategyLab engine.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={loadMarketData} disabled={!!loadingAction} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-blue-500 disabled:opacity-50">
              <RefreshCw className="h-4 w-4" />
              Market Data
            </button>
            <button onClick={saveStrategy} disabled={!!loadingAction} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500 disabled:opacity-50">
              <Settings className="h-4 w-4" />
              Save Strategy
            </button>
            <button onClick={exportToAlgoFin} disabled={!!loadingAction} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-500 disabled:opacity-50">
              <Zap className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {(status || error) && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-rose-500/40 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
            {error || status}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <section className="space-y-4 rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2 text-blue-300">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-100">Strategy Definition</h3>
                <p className="text-xs text-slate-500">Persisted through `/strategy-lab/strategies`</p>
              </div>
            </div>

            <div>
              <label className={labelClass}>Strategy Name</label>
              <input className={fieldClass} value={strategyName} onChange={(event) => setStrategyName(event.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Symbol</label>
              <input className={fieldClass} value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>RSI</label>
                <input className={fieldClass} value={rsiLength} onChange={(event) => setRsiLength(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>EMA S</label>
                <input className={fieldClass} value={emaShort} onChange={(event) => setEmaShort(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>EMA L</label>
                <input className={fieldClass} value={emaLong} onChange={(event) => setEmaLong(event.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Stop %</label>
                <input className={fieldClass} value={stopLossPct} onChange={(event) => setStopLossPct(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Target %</label>
                <input className={fieldClass} value={takeProfitPct} onChange={(event) => setTakeProfitPct(event.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Size %</label>
                <input className={fieldClass} value={positionSize} onChange={(event) => setPositionSize(event.target.value)} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Webhook Route Token</label>
              <input className={fieldClass} value={routeToken} onChange={(event) => setRouteToken(event.target.value)} placeholder="Created by export or paste existing token" />
            </div>

            <div className="rounded-lg border border-slate-700/50 bg-slate-950/40 p-4">
              <p className="mb-2 text-xs uppercase tracking-[0.12em] text-slate-500">Saved Strategy</p>
              <p className="break-all font-mono text-xs text-slate-300">{savedStrategy?.id || 'Not saved yet'}</p>
            </div>
          </section>

          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <MetricTile label="Last Price" value={quote ? `$${quote.price.toFixed(2)}` : '-'} tone="accent" />
              <MetricTile label="Change" value={quote ? `${quote.change >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%` : '-'} tone={quote && quote.change >= 0 ? 'good' : 'bad'} />
              <MetricTile label="Bars Loaded" value={barsLoaded ? barsLoaded.toLocaleString() : '-'} />
              <MetricTile label="Source" value={quote?.source || 'Alpaca'} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-100">Backtest</h3>
                    <p className="text-xs text-slate-500">RSI/EMA simulator running on backend Alpaca bars</p>
                  </div>
                  <button onClick={runBacktest} disabled={!!loadingAction} className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-950 transition-colors hover:bg-white disabled:opacity-50">
                    <BarChart3 className="h-4 w-4" />
                    Run
                  </button>
                </div>

                {metrics ? (
                  <>
                    <div className="mb-5 grid gap-3 md:grid-cols-4">
                      <MetricTile label="Return" value={`${metrics.totalReturnPct >= 0 ? '+' : ''}${metrics.totalReturnPct.toFixed(2)}%`} tone={metrics.totalReturnPct >= 0 ? 'good' : 'bad'} />
                      <MetricTile label="Win Rate" value={`${metrics.winRate.toFixed(1)}%`} />
                      <MetricTile label="Sharpe" value={metrics.sharpe.toFixed(2)} tone="accent" />
                      <MetricTile label="Trades" value={String(metrics.totalTrades)} />
                    </div>
                    <div className="h-[240px] rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={backtest.equityCurve || []}>
                          <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} width={72} />
                          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                          <Line type="monotone" dataKey="equity" stroke="#38bdf8" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
                    Run a backend backtest to populate metrics and equity curve.
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-100">Optimizer</h3>
                    <p className="text-xs text-slate-500">Bounded grid search by Sharpe</p>
                  </div>
                  <button onClick={runOptimization} disabled={!!loadingAction} className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm text-white transition-colors hover:bg-purple-500 disabled:opacity-50">
                    <TrendingUp className="h-4 w-4" />
                    Run
                  </button>
                </div>

                {topResults.length > 0 ? (
                  <div className="space-y-2">
                    {topResults.map((row: any, index: number) => (
                      <div key={`${row.rsiLength}-${row.stopLossPct}-${row.takeProfitPct}-${index}`} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
                        <span className="font-mono text-blue-300">#{index + 1}</span>
                        <span className="text-slate-300">RSI {row.rsiLength} / SL {row.stopLossPct}% / TP {row.takeProfitPct}%</span>
                        <span className="font-mono text-emerald-400">{row.sharpe.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-700 px-6 text-center text-sm text-slate-500">
                    Run optimizer to rank parameter combinations.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-100">PineScript Export</h3>
                    <p className="text-xs text-slate-500">TradingView alerts include AlgoFin route payloads</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={generatePine} disabled={!!loadingAction} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-blue-500 disabled:opacity-50">Generate</button>
                    <button onClick={copyPine} disabled={!pineScript} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-blue-500 disabled:opacity-50">
                      <Copy className="h-4 w-4" />
                      Copy
                    </button>
                  </div>
                </div>
                <pre className="max-h-[360px] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-6 text-slate-300">
                  {pineScript || '// Generate PineScript after saving a strategy and setting a route token.'}
                </pre>
              </div>

              <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-300">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-100">AlgoFin Routing</h3>
                    <p className="text-xs text-slate-500">Exports link StrategyLab to webhook ingestion</p>
                  </div>
                </div>

                {exportRoute ? (
                  <div className="space-y-4">
                    <MetricTile label="Route Token" value={exportRoute.token || '-'} tone="good" />
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                      Export created. TradingView alerts generated from this page will route through AlgoFin webhook ingestion, then risk and OMS layers.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                    <div className="mb-3 flex items-start gap-2 text-amber-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4" />
                      <span>Export requires the backend migration and webhook route table to be available in Supabase.</span>
                    </div>
                    Use Export to create or link a route, then copy the generated PineScript into TradingView.
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        {loadingAction && (
          <div className="fixed bottom-6 right-6 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200 shadow-xl shadow-blue-950/30">
            Running {loadingAction}...
          </div>
        )}
      </div>
    </div>
  );
}

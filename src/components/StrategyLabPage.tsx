import { useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { alpacaAPI, strategyLabAPI } from '../utils/api';
import {
  buildOptionOrderLegs,
  buildSampleOptionContracts,
  estimateOptionOrderPremium,
  filterOptionChainRows,
  findDefaultOptionContract,
  getOptionExpirations,
  normalizeOptionChainRows,
  type OptionChainRow,
  type OptionStrategyType,
} from '../utils/optionChain';
import { Button, Card, EmptyState, KpiCard, Pill, SectionHead, Tabs, formatPct, formatUSD } from './velvet/Primitives';
import { VelvetIcons } from './velvet/icons';

type LabTab = 'Builder' | 'Top 10' | 'Backtest' | 'Optimize' | 'Options' | 'PineScript';
type LabStrategyRow = { id: string; name: string; symbol: string; generated_pinescript?: string };
type LabQuote = { symbol: string; price: number; change: number; changePct: number; source: string; timestamp: string };

const defaultRanges = {
  rsiLength: { min: 10, max: 20, step: 2 },
  stopLossPct: { min: 2, max: 6, step: 1 },
  takeProfitPct: { min: 5, max: 12, step: 1 },
};

const fieldClass =
  'w-full rounded-lg border border-[var(--af-line)] bg-[var(--af-surface)] px-3 py-2 text-sm text-[var(--af-ink)] outline-none transition focus:border-[var(--af-primary)]';
const labelClass = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--af-faint)]';

const fallbackTopStrategies = [
  { rank: 1, name: 'Vertical Spread Income', asset: 'SPY 0DTE', sharpe: 2.34, returnPct: 18.4, drawdown: -4.1, score: 92.4 },
  { rank: 2, name: 'Mean Reversion 20 sigma', asset: 'QQQ', sharpe: 2.12, returnPct: 22.1, drawdown: -7.4, score: 89.7 },
  { rank: 3, name: 'NVDA Momentum Burst', asset: 'NVDA', sharpe: 1.94, returnPct: 41.2, drawdown: -11.2, score: 88.1 },
  { rank: 4, name: 'Iron Condor Weekly', asset: 'SPX', sharpe: 1.88, returnPct: 14.2, drawdown: -3.8, score: 86.0 },
  { rank: 5, name: 'BTC Trend Follow', asset: 'BTC/USD', sharpe: 1.71, returnPct: 35.4, drawdown: -14.8, score: 82.5 },
  { rank: 6, name: 'Bull Call Spread', asset: 'AAPL', sharpe: 1.62, returnPct: 19.6, drawdown: -5.6, score: 79.8 },
  { rank: 7, name: 'VIX Calendar', asset: 'VIX', sharpe: 1.54, returnPct: 11.8, drawdown: -4.2, score: 77.0 },
  { rank: 8, name: 'Pairs KO/PEP', asset: 'KO/PEP', sharpe: 1.48, returnPct: 9.2, drawdown: -3.0, score: 74.6 },
  { rank: 9, name: 'Trend Follow Core', asset: 'QQQ', sharpe: 1.05, returnPct: 16.8, drawdown: -7.1, score: 68.4 },
  { rank: 10, name: 'SOL Scalper', asset: 'SOL/USD', sharpe: 0.98, returnPct: 24.4, drawdown: -18.2, score: 65.1 },
];

const optionTemplates = [
  { id: 'lc', level: 1, name: 'Long Call', type: 'single' as OptionStrategyType, bias: 'bull', complexity: 'Beginner' },
  { id: 'lp', level: 1, name: 'Long Put', type: 'single' as OptionStrategyType, bias: 'bear', complexity: 'Beginner' },
  { id: 'bcs', level: 2, name: 'Bull Call Spread', type: 'vertical' as OptionStrategyType, bias: 'bull', complexity: 'Intermediate' },
  { id: 'bps', level: 2, name: 'Bear Put Spread', type: 'vertical' as OptionStrategyType, bias: 'bear', complexity: 'Intermediate' },
  { id: 'straddle', level: 2, name: 'Long Straddle', type: 'straddle' as OptionStrategyType, bias: 'volatile', complexity: 'Intermediate' },
  { id: 'ic', level: 3, name: 'Iron Condor', type: 'vertical' as OptionStrategyType, bias: 'neutral', complexity: 'Advanced' },
  { id: 'cal', level: 3, name: 'Calendar Spread', type: 'vertical' as OptionStrategyType, bias: 'neutral', complexity: 'Advanced' },
  { id: 'ratio', level: 3, name: 'Ratio Spread', type: 'vertical' as OptionStrategyType, bias: 'neutral', complexity: 'Advanced' },
];

const blockLibrary = [
  { title: 'INDICATORS', tone: 'cyan', items: ['RSI', 'EMA', 'MACD', 'ATR', 'VWAP', 'Bollinger'] },
  { title: 'CONDITIONS', tone: 'indigo', items: ['Cross above', 'Cross below', 'Threshold', 'Time of day'] },
  { title: 'ACTIONS', tone: 'green', items: ['BUY market', 'SELL market', 'BUY limit', 'Close all'] },
  { title: 'RISK', tone: 'red', items: ['Stop loss', 'Take profit', 'Trailing', 'Cooldown'] },
];

const draftBlocks = [
  { kind: 'INDICATOR', label: 'RSI(14)', note: 'lookback 14 bars', tone: 'cyan' },
  { kind: 'CONDITION', label: 'When RSI < 30', note: 'oversold', tone: 'indigo' },
  { kind: 'ACTION', label: 'BUY 1x position', note: 'market order', tone: 'green' },
  { kind: 'CONDITION', label: 'When RSI > 70', note: 'overbought', tone: 'indigo' },
  { kind: 'ACTION', label: 'SELL - close all', note: 'close on signal', tone: 'green' },
  { kind: 'RISK', label: 'Stop loss -2%', note: 'trailing', tone: 'red' },
];

const iterationHistory = [
  { version: 'v1', note: 'RSI(14) -> RSI(10)', sharpe: 1.84, pnl: 820 },
  { version: 'v2', note: 'Threshold 30/70 -> 25/75', sharpe: 2.01, pnl: 1140 },
  { version: 'v3', note: 'Added ATR stop', sharpe: 2.11, pnl: 1380 },
  { version: 'v4', note: 'TF 15m -> 1h', sharpe: 2.34, pnl: 1645 },
];

const blockToneClass: Record<string, string> = {
  cyan: 'border-sky-300 bg-sky-100/75 text-sky-800',
  indigo: 'border-indigo-300 bg-indigo-100/70 text-indigo-800',
  green: 'border-emerald-300 bg-emerald-100/75 text-emerald-800',
  red: 'border-rose-300 bg-rose-100/75 text-rose-800',
};

type CanvasBlock = { id: string; kind: string; label: string; note: string; tone: string };

const blockDefaults: Record<string, Omit<CanvasBlock, 'id'>> = {
  'RSI': { kind: 'INDICATOR', label: 'RSI(14)', note: 'lookback 14 bars', tone: 'cyan' },
  'EMA': { kind: 'INDICATOR', label: 'EMA(20)', note: '20-bar moving average', tone: 'cyan' },
  'MACD': { kind: 'INDICATOR', label: 'MACD(12,26,9)', note: 'fast / slow / signal', tone: 'cyan' },
  'ATR': { kind: 'INDICATOR', label: 'ATR(14)', note: 'average true range', tone: 'cyan' },
  'VWAP': { kind: 'INDICATOR', label: 'VWAP', note: 'volume weighted avg price', tone: 'cyan' },
  'Bollinger': { kind: 'INDICATOR', label: 'Bollinger(20,2)', note: '20-bar, 2σ bands', tone: 'cyan' },
  'Cross above': { kind: 'CONDITION', label: 'Cross above', note: 'indicator crossover up', tone: 'indigo' },
  'Cross below': { kind: 'CONDITION', label: 'Cross below', note: 'indicator crossover down', tone: 'indigo' },
  'Threshold': { kind: 'CONDITION', label: 'When RSI < 30', note: 'threshold comparison', tone: 'indigo' },
  'Time of day': { kind: 'CONDITION', label: 'Time of day', note: 'market session filter', tone: 'indigo' },
  'BUY market': { kind: 'ACTION', label: 'BUY 1x position', note: 'market order', tone: 'green' },
  'SELL market': { kind: 'ACTION', label: 'SELL – close all', note: 'close on signal', tone: 'green' },
  'BUY limit': { kind: 'ACTION', label: 'BUY limit order', note: 'limit price entry', tone: 'green' },
  'Close all': { kind: 'ACTION', label: 'Close all positions', note: 'flatten account', tone: 'green' },
  'Stop loss': { kind: 'RISK', label: 'Stop loss −2%', note: 'trailing stop', tone: 'red' },
  'Take profit': { kind: 'RISK', label: 'Take profit +8%', note: 'profit target', tone: 'red' },
  'Trailing': { kind: 'RISK', label: 'Trailing stop 1.5%', note: 'dynamic exit', tone: 'red' },
  'Cooldown': { kind: 'RISK', label: 'Cooldown 4h', note: 're-entry cooldown', tone: 'red' },
};

function safeNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function MetricTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'pos' | 'neg' | 'primary' }) {
  return <KpiCard label={label} value={value} tone={tone} />;
}

function buildOptionRows(rows: OptionChainRow[], level: 'All' | 'L1' | 'L2' | 'L3') {
  const templates = optionTemplates.filter((template) => level === 'All' || template.level === Number(level[1]));
  const expirations = getOptionExpirations(rows);
  const expirationDate = expirations[0];

  return templates.map((template) => {
    const selected = findDefaultOptionContract({
      rows,
      expirationDate,
      type: template.id === 'lp' || template.id === 'bps' ? 'put' : 'call',
      underlyingPrice: 72,
    });
    const legs = selected
      ? buildOptionOrderLegs({ strategyType: template.type, selected, rows, quantity: 1, side: 'buy' })
      : [];
    const premium = estimateOptionOrderPremium(legs);
    const width = legs.length > 1 ? Math.abs((legs[1]?.strikePrice || 0) - (legs[0]?.strikePrice || 0)) * 100 : null;
    const maxLoss = premium >= 0 ? premium : Math.abs(premium);
    const maxProfit = width == null ? 'Unlimited' : Math.max(0, width - Math.abs(premium));

    return {
      ...template,
      expirationDate,
      legs,
      premium,
      maxLoss,
      maxProfit,
      breakeven: selected ? selected.strikePrice + premium / 100 : null,
    };
  });
}

export function StrategyLabPage() {
  const [tab, setTab] = useState<LabTab>('Builder');
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
  const [optionRows, setOptionRows] = useState<OptionChainRow[]>(() => normalizeOptionChainRows(buildSampleOptionContracts('TQQQ')));
  const [optionLevel, setOptionLevel] = useState<'All' | 'L1' | 'L2' | 'L3'>('All');
  const [canvasBlocks, setCanvasBlocks] = useState<CanvasBlock[]>(() =>
    draftBlocks.map((b, i) => ({ ...b, id: String(i) }))
  );

  const addBlock = (item: string) => {
    const def = blockDefaults[item];
    if (!def) return;
    setCanvasBlocks((prev) => [...prev, { ...def, id: `${Date.now()}-${Math.random()}` }]);
  };

  const removeBlock = (id: string) => {
    setCanvasBlocks((prev) => prev.filter((b) => b.id !== id));
  };

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
    exitRules: [{ indicator: 'RSI', operator: 'crosses_above', value: 70 }],
    risk: {
      stopLossPct: safeNumber(stopLossPct, 3),
      takeProfitPct: safeNumber(takeProfitPct, 8),
      trailingStopPct: 1.5,
    },
    positionSizing: { type: 'percent_of_equity', value: safeNumber(positionSize, 5) },
    metadata: { ui: 'algofin-strategy-lab-velvet' },
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

  const loadMarketData = (forceRefresh = false) => runAction('market', async () => {
    const [quoteResult, barsResult] = await Promise.all([
      strategyLabAPI.getQuote(symbol, { forceRefresh }),
      strategyLabAPI.getBars(symbol, { timeframe: '1D', period: '2y', limit: 1000 }, { forceRefresh }),
    ]);
    setQuote(quoteResult.quote);
    setBarsLoaded(Array.isArray(barsResult.bars) ? barsResult.bars.length : 0);
    setStatus(`Loaded ${quoteResult.quote?.symbol || symbol} market data from Alpaca.`);

    const chain = await alpacaAPI.getOptionChain(symbol, { expiration_date_gte: new Date().toISOString().slice(0, 10), limit: 100 }, { forceRefresh }).catch(() => null);
    if (chain) {
      const rows = Array.isArray(chain?.chain) ? chain.chain : Array.isArray(chain?.contracts) ? normalizeOptionChainRows(chain.contracts, chain.snapshots || {}) : [];
      if (rows.length) setOptionRows(rows);
    }
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
    const result = await strategyLabAPI.runBacktest({ strategyId, symbol, timeframe: '1D', period: '2y', initialCapital: 10000, commissionBps: 0 });
    setBacktest(result.results);
    setStatus('Backtest completed and saved.');
  });

  const runOptimization = () => runAction('optimizer', async () => {
    const strategyId = await ensureStrategyId();
    const result = await strategyLabAPI.runOptimization({ strategyId, symbol, timeframe: '1D', period: '2y', targetMetric: 'sharpe', ranges: defaultRanges, maxCombinations: 500 });
    setOptimization(result.results);
    setStatus('Optimizer completed and saved.');
  });

  const generatePine = () => runAction('pine', async () => {
    const strategyId = await ensureStrategyId();
    if (!routeToken.trim()) throw new Error('Enter a webhook route token or use Export to AlgoFin to create one.');
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
  const topResults = Array.isArray(optimization?.results)
    ? optimization.results.slice(0, 10).map((row: any, index: number) => ({
        rank: index + 1,
        name: `${strategyName} v${index + 1}`,
        asset: symbol,
        sharpe: Number(row.sharpe || row.metrics?.sharpe || 0),
        returnPct: Number(row.totalReturnPct || row.metrics?.totalReturnPct || 0),
        drawdown: Number(row.maxDrawdownPct || row.metrics?.maxDrawdownPct || 0),
        score: Math.max(0, 80 + Number(row.sharpe || 0) * 4 - index),
      }))
    : fallbackTopStrategies;
  const optionStrategyRows = buildOptionRows(optionRows, optionLevel);
  const filteredCalls = filterOptionChainRows({ rows: optionRows, expirationDate: getOptionExpirations(optionRows)[0], type: 'call' });

  return (
    <div className="af-strategylab-view grid gap-2.5">
      <div className="af-strategylab-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--af-ink)]">StrategyLab</h1>
          <p className="mt-1 text-sm text-[var(--af-muted)]">Build - iterate - backtest - keep only the top 10 performers - ship to AlgoFin runtime</p>
        </div>
        <div className="af-strategylab-tabs flex max-w-full overflow-x-auto">
          <Tabs items={['Builder', 'Top 10', 'Backtest', 'Optimize', 'Options', 'PineScript'] as LabTab[]} active={tab} onChange={setTab} />
        </div>
      </div>

      {(status || error) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-[var(--af-neg)]/30 bg-[var(--af-neg-soft)] text-[var(--af-neg)]' : 'border-[var(--af-pos)]/30 bg-[var(--af-pos-soft)] text-[var(--af-pos)]'}`}>
          {error || status}
        </div>
      )}

      {tab === 'Builder' && (
        <div className="af-strategylab-builder grid gap-2.5 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
          <Card className="af-block-library" pad="none">
            <div className="border-b border-[var(--af-line)] px-4 py-2.5">
              <h3 className="text-base font-semibold text-[var(--af-ink)]">Block Library</h3>
              <p className="text-xs text-[var(--af-muted)]">Drag onto canvas</p>
            </div>
            <div className="grid gap-3 p-3">
              {blockLibrary.map((group) => (
                <div key={group.title}>
                  <p className={labelClass}>{group.title}</p>
                  <div className="grid gap-2">
                    {group.items.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => addBlock(item)}
                        className={`w-full cursor-pointer rounded-md border px-3 py-2 text-left text-xs font-semibold transition hover:-translate-y-0.5 active:scale-95 ${blockToneClass[group.tone]}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card pad="none" className="af-builder-canvas-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--af-line)] px-4 py-2.5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold leading-tight text-[var(--af-ink)]">My RSI Mean Reversion</h2>
                  <Pill tone="warn" size="sm" dot>draft</Pill>
                </div>
                <p className="mt-1 af-mono text-xs text-[var(--af-muted)]">{symbol} - 15m - $10,000.00</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" tone="ghost" onClick={saveStrategy} disabled={!!loadingAction}>Save draft</Button>
                <Button size="sm" tone="soft" onClick={runBacktest} disabled={!!loadingAction}>Run backtest</Button>
                <Button size="sm" tone="primary" onClick={runOptimization} disabled={!!loadingAction}>Iterate Ctrl+I</Button>
              </div>
            </div>
            <div
              className="af-builder-canvas min-h-[360px] p-4"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--af-bg), white 30%)',
                backgroundImage: 'linear-gradient(var(--af-line) 1px, transparent 1px), linear-gradient(90deg, var(--af-line) 1px, transparent 1px)',
                backgroundSize: '56px 56px',
              }}
            >
              <div className="grid gap-2.5">
                {canvasBlocks.map((block, index) => (
                  <div key={block.id} className="grid grid-cols-[28px_1fr_22px] items-center gap-2">
                    <span className="af-mono text-center text-xs text-[var(--af-muted)]">{index + 1}</span>
                    <div className={`rounded-lg border px-4 py-2.5 shadow-sm ${blockToneClass[block.tone]}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{block.label}</p>
                          <p className="mt-0.5 text-[10px] opacity-75">{block.note}</p>
                        </div>
                        <span className="af-mono text-[10px] font-bold uppercase opacity-70">{block.kind}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      title="Remove block"
                      className="grid h-5 w-5 place-items-center rounded text-[var(--af-muted)] text-xs hover:bg-[var(--af-neg-soft)] hover:text-[var(--af-neg)]"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="col-start-2 rounded-lg border border-dashed border-[var(--af-line)] bg-white/55 py-2 text-xs font-semibold text-[var(--af-muted)] hover:text-[var(--af-ink)]">+ Add block</button>
              </div>
            </div>
          </Card>

          <div className="af-strategylab-rail grid content-start gap-2.5">
            <Card>
              <SectionHead title="Latest backtest" />
              <p className="af-num text-3xl font-semibold tracking-[-0.03em] text-[var(--af-pos)]">{metrics ? formatUSD(metrics.totalReturn || 1645, { sign: true }) : '+$1,645.00'}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <span>Sharpe <strong>{(metrics?.sharpe || 2.34).toFixed(2)}</strong></span>
                <span>Win <strong>{formatPct(metrics?.winRate || 68, { sign: false })}</strong></span>
                <span>DD <strong className="text-[var(--af-neg)]">{formatPct(metrics?.maxDrawdownPct || -4.1)}</strong></span>
              </div>
            </Card>
            <Card pad="none">
              <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-3">
                <h3 className="text-sm font-semibold text-[var(--af-ink)]">Iteration history</h3>
                <span className="text-[11px] text-[var(--af-muted)]">4 runs</span>
              </div>
              {iterationHistory.map((row) => (
                <div key={row.version} className="grid grid-cols-[1fr_auto] gap-2 border-b border-[var(--af-line)] px-4 py-2 last:border-b-0">
                  <div>
                    <p className="text-sm font-semibold text-[var(--af-ink)]">{row.version}</p>
                    <p className="text-xs text-[var(--af-muted)]">{row.note}</p>
                    <p className="text-[11px] text-[var(--af-muted)]">Sharpe {row.sharpe.toFixed(2)}</p>
                  </div>
                  <span className="af-num text-sm font-semibold text-[var(--af-pos)]">{formatUSD(row.pnl, { sign: true })}</span>
                </div>
              ))}
            </Card>
            <button type="button" onClick={exportToAlgoFin} disabled={!!loadingAction} className="rounded-lg border border-blue-200 bg-blue-100 px-5 py-4 text-left shadow-sm transition hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-60">
              <p className="text-sm font-semibold text-blue-900">Promote to live</p>
              <p className="mt-1 text-xs text-blue-800">Score #92 - would rank #3 in Top 10</p>
            </button>
          </div>
        </div>
      )}

      {tab === 'Backtest' && (
        <Card>
          <SectionHead title="Backtest" sub="RSI/EMA simulator running on backend Alpaca bars" right={<Button tone="primary" size="sm" onClick={runBacktest} disabled={!!loadingAction} icon={VelvetIcons.trades}>Run</Button>} />
          {metrics ? (
            <>
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <MetricTile label="Return" value={formatPct(metrics.totalReturnPct || 0)} tone={(metrics.totalReturnPct || 0) >= 0 ? 'pos' : 'neg'} />
                <MetricTile label="Win Rate" value={formatPct(metrics.winRate || 0, { sign: false })} />
                <MetricTile label="Sharpe" value={(metrics.sharpe || 0).toFixed(2)} tone="primary" />
                <MetricTile label="Max DD" value={formatPct(metrics.maxDrawdownPct || 0)} tone="neg" />
              </div>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={backtest.equityCurve || []}>
                    <XAxis dataKey="time" tick={{ fill: '#757680', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#757680', fontSize: 10 }} width={72} />
                    <Tooltip />
                    <Line type="monotone" dataKey="equity" stroke="oklch(0.50 0.18 270)" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : <EmptyState>Run a backend backtest to populate metrics and equity curve.</EmptyState>}
        </Card>
      )}

      {tab === 'Optimize' && (
        <Card>
          <SectionHead title="Optimizer" sub="Bounded grid search by Sharpe" right={<Button tone="primary" size="sm" onClick={runOptimization} disabled={!!loadingAction}>Run optimizer</Button>} />
          {Array.isArray(optimization?.results) && optimization.results.length ? (
            <div className="grid gap-2">
              {optimization.results.slice(0, 8).map((row: any, index: number) => (
                <div key={index} className="grid grid-cols-[40px_1fr_auto] items-center gap-3 rounded-lg border border-[var(--af-line)] bg-[var(--af-surface-2)] px-3 py-2 text-xs">
                  <span className="af-mono text-[var(--af-primary)]">#{index + 1}</span>
                  <span>RSI {row.rsiLength} / SL {row.stopLossPct}% / TP {row.takeProfitPct}%</span>
                  <Pill tone="primary">Sharpe {(row.sharpe || 0).toFixed(2)}</Pill>
                </div>
              ))}
            </div>
          ) : <EmptyState>Run optimization to rank parameter combinations. Until then, Top 10 uses deterministic sample rows.</EmptyState>}
        </Card>
      )}

      {tab === 'Top 10' && (
        <Card pad="none">
          <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--af-ink)]">Top 10 strategies</h3>
              <p className="text-[11px] text-[var(--af-muted)]">Less-performing candidates auto-discarded · 47 discarded</p>
            </div>
            <Pill tone="primary">Ranked</Pill>
          </div>
          <div className="af-table-head grid-cols-[52px_1.4fr_1fr_90px_90px_90px] px-4 py-2">
            <span>Rank</span><span>Strategy</span><span>Asset</span><span className="text-right">Sharpe</span><span className="text-right">Return</span><span className="text-right">Score</span>
          </div>
          {topResults.map((row) => (
            <div key={`${row.rank}-${row.name}`} className="af-table-row grid-cols-[52px_1.4fr_1fr_90px_90px_90px] px-4 py-3 text-sm">
              <span className="af-mono text-[var(--af-primary)]">#{row.rank}</span>
              <span className="font-semibold text-[var(--af-ink)]">{row.name}</span>
              <span>{row.asset}</span>
              <span className="af-num text-right">{row.sharpe.toFixed(2)}</span>
              <span className="af-num text-right text-[var(--af-pos)]">{formatPct(row.returnPct)}</span>
              <span className="af-num text-right font-semibold">{row.score.toFixed(1)}</span>
            </div>
          ))}
        </Card>
      )}

      {tab === 'Options' && (
        <div className="grid gap-3.5">
          <Card pad="none">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--af-line)] px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--af-ink)]">Options strategies · Level 1 · 2 · 3</h3>
                <p className="text-[11px] text-[var(--af-muted)]">Net debit/credit · max loss · max profit · breakeven · legs</p>
              </div>
              <Tabs items={['All', 'L1', 'L2', 'L3'] as const} active={optionLevel} onChange={setOptionLevel} />
            </div>
            <div className="overflow-x-auto">
              <div className="af-table-head min-w-[920px] grid-cols-[50px_1.3fr_80px_110px_110px_120px_110px_70px_120px] px-4 py-2">
                <span>Lvl</span><span>Strategy</span><span>Bias</span><span className="text-right">Net D/C</span><span className="text-right">Max loss</span><span className="text-right">Max profit</span><span>Breakeven</span><span>Legs</span><span className="text-right"></span>
              </div>
              {optionStrategyRows.map((row) => (
                <div key={row.id} className="af-table-row min-w-[920px] grid-cols-[50px_1.3fr_80px_110px_110px_120px_110px_70px_120px] px-4 py-3 text-xs">
                  <Pill size="sm" tone={row.level === 1 ? 'neutral' : row.level === 2 ? 'primary' : 'warn'}>L{row.level}</Pill>
                  <div><p className="font-semibold text-[var(--af-ink)]">{row.name}</p><p className="text-[10px] text-[var(--af-muted)]">{row.complexity}</p></div>
                  <Pill size="sm" tone={row.bias === 'bull' ? 'pos' : row.bias === 'bear' ? 'neg' : row.bias === 'volatile' ? 'warn' : 'neutral'}>{row.bias}</Pill>
                  <span className={`af-num text-right font-semibold ${row.premium <= 0 ? 'text-[var(--af-neg)]' : 'text-[var(--af-pos)]'}`}>{formatUSD(row.premium, { sign: true })}</span>
                  <span className="af-num text-right text-[var(--af-neg)]">{formatUSD(row.maxLoss)}</span>
                  <span className="af-num text-right text-[var(--af-pos)]">{typeof row.maxProfit === 'number' ? formatUSD(row.maxProfit) : row.maxProfit}</span>
                  <span className="af-num text-[var(--af-muted)]">{row.breakeven ? formatUSD(row.breakeven) : '-'}</span>
                  <span className="text-[var(--af-muted)]">{row.legs.length}</span>
                  <div className="flex justify-end gap-1"><Button size="sm" tone="flat" disabled>Details</Button><Button size="sm" tone="soft" disabled>Build</Button></div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHead title={`Option chain preview · ${symbol}`} sub={`${filteredCalls.length || optionRows.length} contracts available for strategy economics`} right={<Button size="sm" tone="ghost" onClick={() => loadMarketData(true)}>Refresh chain</Button>} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {optionRows.slice(0, 8).map((row) => (
                <div key={row.symbol} className="rounded-lg border border-[var(--af-line)] bg-[var(--af-surface-2)] p-3">
                  <div className="flex items-center justify-between">
                    <Pill size="sm" tone={row.type === 'call' ? 'pos' : 'neg'}>{row.type.toUpperCase()}</Pill>
                    <span className="af-mono text-[10px] text-[var(--af-muted)]">{row.expirationDate}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-[var(--af-ink)]">{formatUSD(row.strikePrice)} strike</p>
                  <p className="af-num mt-1 text-xs text-[var(--af-muted)]">Mark {row.mark == null ? '-' : formatUSD(row.mark)} · Δ {row.delta?.toFixed(2) || '-'}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'PineScript' && (
        <Card pad="none">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--af-line)] px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--af-ink)]">Generated Pine v5</h3>
              <p className="text-[11px] text-[var(--af-muted)]">Auto-exported · ready to paste into TradingView</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" tone="ghost" onClick={generatePine} disabled={!!loadingAction}>Generate</Button>
              <Button size="sm" tone="primary" onClick={copyPine} disabled={!pineScript}>Copy</Button>
            </div>
          </div>
          <div className="border-b border-[var(--af-line)] p-4">
            <label className={labelClass}>Route token</label>
            <input className={fieldClass} value={routeToken} onChange={(event) => setRouteToken(event.target.value)} placeholder="Export to AlgoFin or paste webhook token" />
          </div>
          <pre className="af-mono m-0 max-h-[420px] overflow-auto bg-[var(--af-surface-2)] p-4 text-xs leading-relaxed text-[var(--af-ink-2)]">
            {pineScript || '// Generate PineScript after saving a strategy and setting a route token.'}
          </pre>
          {exportRoute && <div className="border-t border-[var(--af-line)] px-4 py-3 text-xs text-[var(--af-muted)]">Export route: <span className="af-mono text-[var(--af-ink)]">{exportRoute.token || exportRoute.id}</span></div>}
        </Card>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Settings,
  Shield,
  Target,
  Zap,
} from './CustomIcons';
import {
  buildDefaultAutomationPreview,
  buildOperationsReadinessReport,
  buildSampleOmsOrders,
  buildSampleRiskAudits,
  operationsPanels,
  type AutomationPreview,
  type OperationsPanelId,
} from '../utils/operationsDashboard';
import { summarizeReadiness } from '../utils/productionReadiness';
import { alpacaAPI } from '../utils/api';
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
  type OptionType,
} from '../utils/optionChain';

const panelIcon: Record<OperationsPanelId, any> = {
  risk: Shield,
  oms: Activity,
  options: Target,
  automation: Zap,
  readiness: CheckCircle2,
};

const statusClass: Record<string, string> = {
  allow: 'bg-emerald-500/10 text-emerald-400',
  accepted: 'bg-blue-500/10 text-blue-400',
  ready: 'bg-emerald-500/10 text-emerald-400',
  filled: 'bg-emerald-500/10 text-emerald-400',
  pass: 'bg-emerald-500/10 text-emerald-400',
  warn: 'bg-yellow-500/10 text-yellow-400',
  warning: 'bg-yellow-500/10 text-yellow-400',
  partially_filled: 'bg-yellow-500/10 text-yellow-400',
  block: 'bg-rose-500/10 text-rose-400',
  blocked: 'bg-rose-500/10 text-rose-400',
  rejected: 'bg-rose-500/10 text-rose-400',
  fail: 'bg-rose-500/10 text-rose-400',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-xs ${statusClass[status] || 'bg-slate-800 text-slate-300'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500"
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-blue-500"
    />
  );
}

export function OperationsPage() {
  const initialOptionRows = useMemo(() => normalizeOptionChainRows(buildSampleOptionContracts('TQQQ')), []);
  const initialOption = useMemo(() => findDefaultOptionContract({
    rows: initialOptionRows,
    expirationDate: getOptionExpirations(initialOptionRows)[0],
    type: 'call',
    underlyingPrice: 71.55,
  }), [initialOptionRows]);
  const [activePanel, setActivePanel] = useState<OperationsPanelId>('risk');
  const [riskSettings, setRiskSettings] = useState({
    killSwitchEnabled: false,
    maxPositionSize: '5000',
    maxDailyLoss: '1200',
    restrictedSymbols: 'GME, AMC',
    allowedSymbols: 'AAPL, MSFT, NVDA, TSLA',
  });
  const [optionOrder, setOptionOrder] = useState({
    underlying: 'TQQQ',
    side: 'buy',
    quantity: '1',
    strategyType: 'single' as OptionStrategyType,
  });
  const [optionRows, setOptionRows] = useState<OptionChainRow[]>(initialOptionRows);
  const [selectedExpiration, setSelectedExpiration] = useState(getOptionExpirations(initialOptionRows)[0] || '');
  const [selectedOptionType, setSelectedOptionType] = useState<OptionType | 'all'>('call');
  const [selectedOptionSymbol, setSelectedOptionSymbol] = useState(initialOption?.symbol || '');
  const [optionDataState, setOptionDataState] = useState({
    loading: false,
    source: 'sample option chain',
    error: '',
  });
  const [automation, setAutomation] = useState<AutomationPreview>(buildDefaultAutomationPreview());
  const [lastAction, setLastAction] = useState('No operations action has been submitted in this session.');

  const riskAudits = useMemo(() => buildSampleRiskAudits(), []);
  const omsOrders = useMemo(() => buildSampleOmsOrders(), []);
  const readiness = useMemo(() => buildOperationsReadinessReport(), []);
  const activeDefinition = operationsPanels.find((panel) => panel.id === activePanel) || operationsPanels[0];
  const optionExpirations = useMemo(() => getOptionExpirations(optionRows), [optionRows]);
  const visibleOptionRows = useMemo(() => filterOptionChainRows({
    rows: optionRows,
    expirationDate: selectedExpiration,
    type: selectedOptionType,
  }), [optionRows, selectedExpiration, selectedOptionType]);
  const selectedOption = useMemo(() => (
    optionRows.find((row) => row.symbol === selectedOptionSymbol) ||
    findDefaultOptionContract({
      rows: optionRows,
      expirationDate: selectedExpiration,
      type: selectedOptionType === 'all' ? 'call' : selectedOptionType,
    })
  ), [optionRows, selectedExpiration, selectedOptionSymbol, selectedOptionType]);
  const optionLegs = useMemo(() => (
    selectedOption
      ? buildOptionOrderLegs({
          strategyType: optionOrder.strategyType,
          selected: selectedOption,
          rows: optionRows,
          quantity: Number(optionOrder.quantity) || 1,
          side: optionOrder.side as 'buy' | 'sell',
        })
      : []
  ), [optionOrder.quantity, optionOrder.side, optionOrder.strategyType, optionRows, selectedOption]);
  const estimatedPremium = useMemo(() => estimateOptionOrderPremium(optionLegs), [optionLegs]);

  useEffect(() => {
    if (activePanel !== 'options') return;

    const symbol = optionOrder.underlying.trim().toUpperCase();
    if (!symbol) return;

    const timeout = window.setTimeout(() => {
      loadOptionData(symbol);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [activePanel, optionOrder.underlying]);

  useEffect(() => {
    const nextDefault = findDefaultOptionContract({
      rows: optionRows,
      expirationDate: selectedExpiration,
      type: selectedOptionType === 'all' ? 'call' : selectedOptionType,
    });

    if (nextDefault && !visibleOptionRows.some((row) => row.symbol === selectedOptionSymbol)) {
      setSelectedOptionSymbol(nextDefault.symbol);
    }
  }, [optionRows, selectedExpiration, selectedOptionSymbol, selectedOptionType, visibleOptionRows]);

  const saveRiskSettings = () => {
    setLastAction(`Risk settings staged: kill switch ${riskSettings.killSwitchEnabled ? 'enabled' : 'disabled'}, max position $${riskSettings.maxPositionSize}.`);
  };

  const stageOptionOrder = () => {
    const symbols = optionLegs.map((leg) => `${leg.side.toUpperCase()} ${leg.symbol}`).join(', ');
    setLastAction(`Options order staged: ${optionOrder.strategyType}: ${symbols}. Net premium ${estimatedPremium >= 0 ? 'debit' : 'credit'} $${Math.abs(estimatedPremium).toFixed(2)}.`);
  };

  const loadOptionData = async (symbol: string) => {
    try {
      setOptionDataState((current) => ({ ...current, loading: true, error: '' }));

      const today = new Date().toISOString().slice(0, 10);
      const [contractsResponse, chainResponse] = await Promise.all([
        alpacaAPI.getOptionContracts(symbol, {
          status: 'active',
          expiration_date_gte: today,
          limit: 1000,
        }, { forceRefresh: true }).catch((error) => ({ error })),
        alpacaAPI.getOptionChain(symbol, {
          feed: 'indicative',
          limit: 1000,
        }, { forceRefresh: true }).catch(() => ({})),
      ]);

      const contracts = Array.isArray((contractsResponse as any)?.option_contracts)
        ? (contractsResponse as any).option_contracts
        : [];
      const snapshots = (chainResponse as any)?.snapshots || (chainResponse as any) || {};
      const rows = contracts.length > 0
        ? normalizeOptionChainRows(contracts, snapshots)
        : normalizeOptionChainRows(buildSampleOptionContracts(symbol));

      const expirations = getOptionExpirations(rows);
      const nextExpiration = expirations.includes(selectedExpiration)
        ? selectedExpiration
        : expirations[0] || '';
      const nextDefault = findDefaultOptionContract({
        rows,
        expirationDate: nextExpiration,
        type: selectedOptionType === 'all' ? 'call' : selectedOptionType,
      });

      setOptionRows(rows);
      setSelectedExpiration(nextExpiration);
      setSelectedOptionSymbol(nextDefault?.symbol || rows[0]?.symbol || '');
      setOptionDataState({
        loading: false,
        source: contracts.length > 0 ? 'Alpaca contracts + option snapshots' : 'sample option chain',
        error: contracts.length > 0 ? '' : 'Alpaca contracts unavailable; showing sample structure.',
      });
    } catch (error: any) {
      const rows = normalizeOptionChainRows(buildSampleOptionContracts(symbol));
      setOptionRows(rows);
      setSelectedExpiration(getOptionExpirations(rows)[0] || '');
      setSelectedOptionSymbol(rows[0]?.symbol || '');
      setOptionDataState({
        loading: false,
        source: 'sample option chain',
        error: error?.message || 'Alpaca options data unavailable.',
      });
    }
  };

  const saveAutomation = () => {
    setLastAction(`Automation schedule staged for ${automation.strategyId}: every ${automation.intervalMinutes} minutes, confidence >= ${automation.minConfidence}.`);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="mb-2 text-slate-100">Operations</h2>
          <p className="max-w-3xl text-slate-400">
            Manage risk, order lifecycle, options staging, strategy automation, and production readiness from one control surface.
          </p>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          {lastAction}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-5">
        {operationsPanels.map((panel) => {
          const Icon = panelIcon[panel.id];
          const selected = activePanel === panel.id;

          return (
            <button
              key={panel.id}
              onClick={() => setActivePanel(panel.id)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                selected
                  ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                  : 'border-slate-700/50 bg-slate-900/30 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <Icon className="h-5 w-5" />
                <span className="text-xs">{panel.label}</span>
              </div>
              <p className="text-sm text-slate-100">{panel.title}</p>
            </button>
          );
        })}
      </div>

      <div className="mb-6 rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-slate-100">{activeDefinition.title}</h3>
            <p className="mt-1 text-sm text-slate-400">{activeDefinition.description}</p>
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {activePanel === 'risk' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Risk Controls</h4>
              </div>
              <div className="space-y-4">
                <label className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-3 text-sm text-slate-300">
                  Account kill switch
                  <input
                    type="checkbox"
                    checked={riskSettings.killSwitchEnabled}
                    onChange={(event) => setRiskSettings((current) => ({ ...current, killSwitchEnabled: event.target.checked }))}
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>
                <Field label="Max position size">
                  <TextInput value={riskSettings.maxPositionSize} onChange={(event) => setRiskSettings((current) => ({ ...current, maxPositionSize: event.target.value }))} />
                </Field>
                <Field label="Max daily loss">
                  <TextInput value={riskSettings.maxDailyLoss} onChange={(event) => setRiskSettings((current) => ({ ...current, maxDailyLoss: event.target.value }))} />
                </Field>
                <Field label="Restricted symbols">
                  <TextInput value={riskSettings.restrictedSymbols} onChange={(event) => setRiskSettings((current) => ({ ...current, restrictedSymbols: event.target.value }))} />
                </Field>
                <Field label="Allowed symbols">
                  <TextInput value={riskSettings.allowedSymbols} onChange={(event) => setRiskSettings((current) => ({ ...current, allowedSymbols: event.target.value }))} />
                </Field>
                <button onClick={saveRiskSettings} className="w-full rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600">
                  Save Risk Settings
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-700/50">
              <table className="w-full">
                <thead className="bg-slate-950/40 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-4">Audit ID</th>
                    <th className="p-4">Source</th>
                    <th className="p-4">Symbol</th>
                    <th className="p-4">Decision</th>
                    <th className="p-4">Summary</th>
                    <th className="p-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {riskAudits.map((audit) => (
                    <tr key={audit.id} className="border-t border-slate-700/40 text-sm">
                      <td className="p-4 font-mono text-slate-300">{audit.id}</td>
                      <td className="p-4 text-slate-300">{audit.source}</td>
                      <td className="p-4 font-mono text-blue-400">{audit.symbol}</td>
                      <td className="p-4"><StatusPill status={audit.status} /></td>
                      <td className="p-4 text-slate-400">{audit.summary}</td>
                      <td className="p-4 text-slate-500">{new Date(audit.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activePanel === 'oms' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Metric label="Open lifecycle orders" value="2" tone="blue" />
              <Metric label="Partial fills" value="1" tone="yellow" />
              <Metric label="Risk rejected" value="1" tone="rose" />
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-700/50">
              <table className="w-full">
                <thead className="bg-slate-950/40 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-4">Order ID</th>
                    <th className="p-4">Symbol</th>
                    <th className="p-4">Source</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Filled</th>
                    <th className="p-4">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {omsOrders.map((order) => (
                    <tr key={order.id} className="border-t border-slate-700/40 text-sm">
                      <td className="p-4 font-mono text-slate-300">{order.id}</td>
                      <td className="p-4 font-mono text-blue-400">{order.symbol}</td>
                      <td className="p-4 text-slate-300">{order.source}</td>
                      <td className="p-4"><StatusPill status={order.status} /></td>
                      <td className="p-4 text-slate-300">{order.filledQuantity} / {order.quantity}</td>
                      <td className="p-4 text-slate-500">{new Date(order.updatedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activePanel === 'options' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[460px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Options Entry</h4>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Underlying"><TextInput value={optionOrder.underlying} onChange={(event) => setOptionOrder((current) => ({ ...current, underlying: event.target.value.toUpperCase() }))} /></Field>
                <Field label="Expiration">
                  <SelectInput value={selectedExpiration} onChange={(event) => setSelectedExpiration(event.target.value)}>
                    {optionExpirations.map((expiration) => (
                      <option key={expiration} value={expiration}>{expiration}</option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="Chain side">
                  <SelectInput value={selectedOptionType} onChange={(event) => setSelectedOptionType(event.target.value as OptionType | 'all')}>
                    <option value="call">Calls</option>
                    <option value="put">Puts</option>
                    <option value="all">Calls and puts</option>
                  </SelectInput>
                </Field>
                <Field label="Strategy"><SelectInput value={optionOrder.strategyType} onChange={(event) => setOptionOrder((current) => ({ ...current, strategyType: event.target.value as OptionStrategyType }))}><option value="single">Single leg</option><option value="vertical">Vertical spread</option><option value="straddle">Long straddle</option></SelectInput></Field>
                <Field label="Side"><SelectInput value={optionOrder.side} onChange={(event) => setOptionOrder((current) => ({ ...current, side: event.target.value }))}><option value="buy">Buy</option><option value="sell">Sell</option></SelectInput></Field>
                <Field label="Quantity"><TextInput value={optionOrder.quantity} onChange={(event) => setOptionOrder((current) => ({ ...current, quantity: event.target.value }))} /></Field>
              </div>
              <div className="mt-4 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 text-xs text-slate-400">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span>Data source</span>
                  <span className="text-slate-300">{optionDataState.loading ? 'Loading...' : optionDataState.source}</span>
                </div>
                {optionDataState.error && <p className="text-yellow-300">{optionDataState.error}</p>}
              </div>
              <button onClick={stageOptionOrder} className="mt-5 w-full rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600">
                Stage Options Order
              </button>
            </div>

            <div className="space-y-6">
              <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h4 className="text-slate-100">Alpaca Option Chain</h4>
                  <button
                    onClick={() => loadOptionData(optionOrder.underlying.trim().toUpperCase())}
                    className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-700"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reload chain
                  </button>
                </div>
                <div className="max-h-[360px] overflow-auto rounded-lg border border-slate-700/50">
                  <table className="w-full min-w-[980px]">
                    <thead className="sticky top-0 bg-slate-950 text-left text-xs text-slate-500">
                      <tr>
                        <th className="p-3">Strike</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Symbol</th>
                        <th className="p-3">Bid</th>
                        <th className="p-3">Ask</th>
                        <th className="p-3">Last</th>
                        <th className="p-3">IV</th>
                        <th className="p-3">Delta</th>
                        <th className="p-3">Volume</th>
                        <th className="p-3">Open Interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleOptionRows.map((row) => (
                        <tr
                          key={row.symbol}
                          onClick={() => setSelectedOptionSymbol(row.symbol)}
                          className={`cursor-pointer border-t border-slate-700/40 text-sm transition-colors hover:bg-slate-800/50 ${
                            selectedOption?.symbol === row.symbol ? 'bg-blue-500/10' : ''
                          }`}
                        >
                          <td className="p-3 font-mono text-slate-100">{row.strikePrice.toFixed(2)}</td>
                          <td className="p-3 capitalize text-slate-300">{row.type}</td>
                          <td className="p-3 font-mono text-blue-400">{row.symbol}</td>
                          <td className="p-3 font-mono text-rose-300">{formatOptionNumber(row.bid)}</td>
                          <td className="p-3 font-mono text-emerald-300">{formatOptionNumber(row.ask)}</td>
                          <td className="p-3 font-mono text-slate-300">{formatOptionNumber(row.last)}</td>
                          <td className="p-3 font-mono text-slate-300">{row.impliedVolatility == null ? '-' : `${(row.impliedVolatility * 100).toFixed(1)}%`}</td>
                          <td className="p-3 font-mono text-slate-300">{formatOptionNumber(row.delta, 2)}</td>
                          <td className="p-3 font-mono text-slate-300">{row.volume ?? '-'}</td>
                          <td className="p-3 font-mono text-slate-300">{row.openInterest ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
                <h4 className="mb-4 text-slate-100">Review Ticket</h4>
                <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <ReviewItem label="Strategy type" value={optionOrder.strategyType === 'vertical' ? 'Vertical spread' : optionOrder.strategyType === 'straddle' ? 'Long straddle' : 'Single leg'} />
                  <ReviewItem label="Legs" value={String(optionLegs.length)} />
                  <ReviewItem label="Net premium" value={`${estimatedPremium >= 0 ? 'Debit' : 'Credit'} $${Math.abs(estimatedPremium).toFixed(2)}`} />
                  <ReviewItem label="Expiration" value={selectedExpiration || '-'} />
                </div>
                <div className="overflow-hidden rounded-lg border border-slate-700/50">
                  <table className="w-full">
                    <thead className="bg-slate-950/50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="p-3">Leg</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Contract</th>
                        <th className="p-3">Strike</th>
                        <th className="p-3">Mark</th>
                        <th className="p-3">Intent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionLegs.map((leg, index) => (
                        <tr key={leg.id} className="border-t border-slate-700/40 text-sm">
                          <td className="p-3 text-slate-400">{index + 1}</td>
                          <td className={leg.side === 'buy' ? 'p-3 text-emerald-400' : 'p-3 text-rose-400'}>{leg.side.toUpperCase()} {leg.ratioQuantity}</td>
                          <td className="p-3 font-mono text-blue-400">{leg.symbol}</td>
                          <td className="p-3 font-mono text-slate-300">{leg.strikePrice.toFixed(2)} {leg.type.toUpperCase()}</td>
                          <td className="p-3 font-mono text-slate-300">{formatOptionNumber(leg.limitPrice)}</td>
                          <td className="p-3 text-slate-300">{leg.positionIntent.replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                  Multi-leg tickets are built from same-expiration Alpaca contracts. Account approval level and Alpaca order-class validation still run before live submission.
                </div>
              </div>
            </div>
          </div>
        )}

        {activePanel === 'automation' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Schedule Controls</h4>
              </div>
              <div className="space-y-4">
                <label className="flex items-center justify-between rounded-lg bg-slate-800/40 px-3 py-3 text-sm text-slate-300">
                  Automation enabled
                  <input
                    type="checkbox"
                    checked={automation.enabled}
                    onChange={(event) => setAutomation((current) => ({ ...current, enabled: event.target.checked }))}
                    className="h-4 w-4 accent-blue-500"
                  />
                </label>
                <Field label="Strategy ID"><TextInput value={automation.strategyId} onChange={(event) => setAutomation((current) => ({ ...current, strategyId: event.target.value }))} /></Field>
                <Field label="Interval minutes"><TextInput value={automation.intervalMinutes} onChange={(event) => setAutomation((current) => ({ ...current, intervalMinutes: Number(event.target.value) || 1 }))} /></Field>
                <Field label="Minimum confidence"><TextInput value={automation.minConfidence} onChange={(event) => setAutomation((current) => ({ ...current, minConfidence: Number(event.target.value) || 0 }))} /></Field>
                <Field label="Max signals per run"><TextInput value={automation.maxSignalsPerRun} onChange={(event) => setAutomation((current) => ({ ...current, maxSignalsPerRun: Number(event.target.value) || 1 }))} /></Field>
                <Field label="Allowed symbols"><TextInput value={automation.allowedSymbols.join(', ')} onChange={(event) => setAutomation((current) => ({ ...current, allowedSymbols: event.target.value.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean) }))} /></Field>
                <button onClick={saveAutomation} className="w-full rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600">
                  Save Automation Schedule
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-slate-100">Next Run Plan</h4>
                <button onClick={saveAutomation} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-600">
                  <Play className="h-4 w-4" />
                  Run Preview
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Metric label="Eligible signals" value="2" tone="blue" />
                <Metric label="Blocked by filters" value="2" tone="yellow" />
                <Metric label="Risk blocks" value="0" tone="emerald" />
              </div>
              <div className="mt-5 space-y-3">
                {['AAPL momentum breakout', 'MSFT trend continuation'].map((signal) => (
                  <div key={signal} className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                    <div>
                      <p className="text-sm text-slate-100">{signal}</p>
                      <p className="text-xs text-slate-500">python-strategy-runner</p>
                    </div>
                    <StatusPill status="ready" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activePanel === 'readiness' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Readiness Summary</h4>
              </div>
              <div className="mb-4">
                <StatusPill status={readiness.status} />
              </div>
              <p className="text-sm text-slate-400">{summarizeReadiness(readiness)}</p>
              <div className="mt-5 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 text-sm text-slate-300">
                Supabase migrations are represented in the repo and the readiness check now reflects current deployed prerequisites. Broker credentials are checked through connected accounts instead of a global Alpaca API key.
              </div>
            </div>
            <div className="space-y-4">
              {readiness.blockers.map((blocker) => (
                <ReadinessRow key={blocker} icon={AlertTriangle} status="blocked" text={blocker} />
              ))}
              {readiness.passed.map((passed) => (
                <ReadinessRow key={passed} icon={CheckCircle2} status="pass" text={passed} />
              ))}
              <ReadinessRow icon={Clock} status="warning" text="Confirm Render auto-deploy completed for the latest GitHub commit." />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'yellow' | 'rose' | 'emerald' }) {
  const toneClass = {
    blue: 'text-blue-400',
    yellow: 'text-yellow-400',
    rose: 'text-rose-400',
    emerald: 'text-emerald-400',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-4">
      <p className="mb-1 text-xs text-slate-500">{label}</p>
      <p className={`font-mono text-2xl ${toneClass}`}>{value}</p>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
      <p className="mb-1 text-xs text-slate-500">{label}</p>
      <p className="font-mono text-sm text-slate-100">{value}</p>
    </div>
  );
}

function ReadinessRow({ icon: Icon, status, text }: { icon: any; status: string; text: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-700/50 bg-slate-950/30 p-4">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-slate-400" />
        <p className="text-sm text-slate-300">{text}</p>
      </div>
      <StatusPill status={status} />
    </div>
  );
}

function formatOptionNumber(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

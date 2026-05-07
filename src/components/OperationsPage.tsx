import { useMemo, useState, type ReactNode } from 'react';
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
  const [activePanel, setActivePanel] = useState<OperationsPanelId>('risk');
  const [riskSettings, setRiskSettings] = useState({
    killSwitchEnabled: false,
    maxPositionSize: '5000',
    maxDailyLoss: '1200',
    restrictedSymbols: 'GME, AMC',
    allowedSymbols: 'AAPL, MSFT, NVDA, TSLA',
  });
  const [optionOrder, setOptionOrder] = useState({
    underlying: 'AAPL',
    expiration: '2026-06-19',
    strike: '200',
    type: 'call',
    side: 'buy',
    quantity: '1',
    limitPrice: '5.25',
    strategyType: 'single',
  });
  const [automation, setAutomation] = useState<AutomationPreview>(buildDefaultAutomationPreview());
  const [lastAction, setLastAction] = useState('No operations action has been submitted in this session.');

  const riskAudits = useMemo(() => buildSampleRiskAudits(), []);
  const omsOrders = useMemo(() => buildSampleOmsOrders(), []);
  const readiness = useMemo(() => buildOperationsReadinessReport(), []);
  const activeDefinition = operationsPanels.find((panel) => panel.id === activePanel) || operationsPanels[0];

  const saveRiskSettings = () => {
    setLastAction(`Risk settings staged: kill switch ${riskSettings.killSwitchEnabled ? 'enabled' : 'disabled'}, max position $${riskSettings.maxPositionSize}.`);
  };

  const stageOptionOrder = () => {
    setLastAction(`Options order staged: ${optionOrder.side.toUpperCase()} ${optionOrder.quantity} ${optionOrder.underlying} ${optionOrder.expiration} ${optionOrder.strike}${optionOrder.type === 'call' ? 'C' : 'P'} @ ${optionOrder.limitPrice}.`);
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
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Options Entry</h4>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Underlying"><TextInput value={optionOrder.underlying} onChange={(event) => setOptionOrder((current) => ({ ...current, underlying: event.target.value.toUpperCase() }))} /></Field>
                <Field label="Expiration"><TextInput type="date" value={optionOrder.expiration} onChange={(event) => setOptionOrder((current) => ({ ...current, expiration: event.target.value }))} /></Field>
                <Field label="Strike"><TextInput value={optionOrder.strike} onChange={(event) => setOptionOrder((current) => ({ ...current, strike: event.target.value }))} /></Field>
                <Field label="Type"><SelectInput value={optionOrder.type} onChange={(event) => setOptionOrder((current) => ({ ...current, type: event.target.value }))}><option value="call">Call</option><option value="put">Put</option></SelectInput></Field>
                <Field label="Side"><SelectInput value={optionOrder.side} onChange={(event) => setOptionOrder((current) => ({ ...current, side: event.target.value }))}><option value="buy">Buy</option><option value="sell">Sell</option></SelectInput></Field>
                <Field label="Quantity"><TextInput value={optionOrder.quantity} onChange={(event) => setOptionOrder((current) => ({ ...current, quantity: event.target.value }))} /></Field>
                <Field label="Limit price"><TextInput value={optionOrder.limitPrice} onChange={(event) => setOptionOrder((current) => ({ ...current, limitPrice: event.target.value }))} /></Field>
                <Field label="Strategy"><SelectInput value={optionOrder.strategyType} onChange={(event) => setOptionOrder((current) => ({ ...current, strategyType: event.target.value }))}><option value="single">Single leg</option><option value="vertical">Vertical spread</option></SelectInput></Field>
              </div>
              <button onClick={stageOptionOrder} className="mt-5 w-full rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600">
                Stage Options Order
              </button>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <h4 className="mb-4 text-slate-100">Review Ticket</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ReviewItem label="Contract" value={`${optionOrder.underlying} ${optionOrder.expiration} ${optionOrder.strike}${optionOrder.type === 'call' ? 'C' : 'P'}`} />
                <ReviewItem label="Instruction" value={`${optionOrder.side.toUpperCase()} ${optionOrder.quantity} @ ${optionOrder.limitPrice}`} />
                <ReviewItem label="Strategy type" value={optionOrder.strategyType === 'vertical' ? 'Vertical spread' : 'Single leg'} />
                <ReviewItem label="Estimated premium" value={`$${(Number(optionOrder.quantity || 0) * Number(optionOrder.limitPrice || 0) * 100).toFixed(2)}`} />
              </div>
              <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
                Broker capability checks run before submission. Alpaca options are enabled in the shared risk gate; account approval level still needs to be checked before live submission.
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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { strategyAutomationAPI } from '../utils/api';
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
import { OptionsOrderTicket } from './OptionsOrderTicket';
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
  completed: 'bg-emerald-500/10 text-emerald-400',
  failed: 'bg-rose-500/10 text-rose-400',
};

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed';

type AutomationScheduleRow = {
  strategy_id: string;
  enabled: boolean;
  interval_minutes: number;
  max_signals_per_run: number;
  min_confidence: number;
  allowed_symbols: string[] | null;
};

type AutomationRunRow = {
  id: string;
  strategy_id: string;
  status: string;
  accepted_order_ids: string[] | null;
  blocked_order_ids: string[] | null;
  started_at: string;
  completed_at?: string | null;
  metadata?: Record<string, any> | null;
};

type RunOutcome = { tone: 'ok' | 'info' | 'error'; message: string };

const runOutcomeClass: Record<RunOutcome['tone'], string> = {
  ok: 'bg-emerald-500/10 text-emerald-300',
  info: 'bg-blue-500/10 text-blue-300',
  error: 'bg-rose-500/10 text-rose-300',
};

function describeAutomationRun(result: any): RunOutcome {
  const run = result?.run ?? {};
  const accepted = Array.isArray(run.accepted_order_ids) ? run.accepted_order_ids.length : 0;
  const blocked = Array.isArray(run.blocked_order_ids) ? run.blocked_order_ids.length : 0;
  const metadata = run.metadata ?? {};
  switch (run.status) {
    case 'completed':
      return { tone: 'ok', message: `Run completed: ${accepted} accepted, ${blocked} blocked.` };
    case 'no_signals':
      return { tone: 'info', message: 'Run recorded. Runs execute signals supplied by the strategy runner (Python runner or API callers); none were provided.' };
    case 'not_due':
      return { tone: 'info', message: 'Previous run is more recent than the interval.' };
    case 'disabled':
      return { tone: 'info', message: 'Schedule is disabled.' };
    case 'failed':
      return { tone: 'error', message: `Run failed: ${metadata.error || metadata.reason || result?.error || 'unknown error'}.` };
    default:
      return { tone: 'info', message: run.status ? `Run recorded with status ${String(run.status)}.` : 'Run recorded.' };
  }
}

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

export function OperationsPage({ active = true }: { active?: boolean }) {
  const [activePanel, setActivePanel] = useState<OperationsPanelId>('risk');
  const [riskSettings, setRiskSettings] = useState({
    killSwitchEnabled: false,
    maxPositionSize: '5000',
    maxDailyLoss: '1200',
    restrictedSymbols: 'GME, AMC',
    allowedSymbols: 'AAPL, MSFT, NVDA, TSLA',
  });
  const [automation, setAutomation] = useState<AutomationPreview>(buildDefaultAutomationPreview());
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [running, setRunning] = useState(false);
  const [runOutcome, setRunOutcome] = useState<RunOutcome | null>(null);
  const [recentRuns, setRecentRuns] = useState<AutomationRunRow[]>([]);
  const [runsError, setRunsError] = useState('');
  const [lastAction, setLastAction] = useState('No operations action has been submitted in this session.');

  const riskAudits = useMemo(() => buildSampleRiskAudits(), []);
  const omsOrders = useMemo(() => buildSampleOmsOrders(), []);
  const readiness = useMemo(() => buildOperationsReadinessReport(), []);
  const activeDefinition = operationsPanels.find((panel) => panel.id === activePanel) || operationsPanels[0];
  const saveRiskSettings = () => {
    setLastAction(`Risk settings staged: kill switch ${riskSettings.killSwitchEnabled ? 'enabled' : 'disabled'}, max position $${riskSettings.maxPositionSize}.`);
  };

  const loadAutomationSchedules = useCallback(async (strategyId: string) => {
    setSchedulesLoading(true);
    setScheduleError('');
    try {
      const rows = ((await strategyAutomationAPI.getSchedules({ forceRefresh: true })) || []) as AutomationScheduleRow[];
      const selected = rows.find((row) => row.strategy_id === strategyId) || rows[0];
      if (selected) {
        setAutomation({
          strategyId: selected.strategy_id,
          enabled: selected.enabled === true,
          intervalMinutes: Number(selected.interval_minutes) || 1,
          minConfidence: Number(selected.min_confidence) || 0,
          maxSignalsPerRun: Number(selected.max_signals_per_run) || 1,
          allowedSymbols: Array.isArray(selected.allowed_symbols) ? selected.allowed_symbols : [],
        });
      }
      return selected?.strategy_id || strategyId;
    } catch (error) {
      setScheduleError(`Could not load automation schedules: ${errorText(error)}`);
      return strategyId;
    } finally {
      setSchedulesLoading(false);
    }
  }, []);

  const loadAutomationRuns = useCallback(async (strategyId: string) => {
    if (!strategyId.trim()) {
      setRecentRuns([]);
      return;
    }
    setRunsError('');
    try {
      const rows = ((await strategyAutomationAPI.getRuns(strategyId, { forceRefresh: true })) || []) as AutomationRunRow[];
      setRecentRuns(rows.slice(0, 5));
    } catch (error) {
      setRunsError(`Could not load recent runs: ${errorText(error)}`);
    }
  }, []);

  // Load the saved schedule and recent runs once when the automation panel is opened.
  // The strategy ID is read from the render snapshot so editing the form does not re-fetch.
  useEffect(() => {
    if (activePanel !== 'automation') return;
    let canceled = false;
    void (async () => {
      const resolvedStrategyId = await loadAutomationSchedules(automation.strategyId);
      if (canceled) return;
      await loadAutomationRuns(resolvedStrategyId);
    })();
    return () => { canceled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanel, loadAutomationSchedules, loadAutomationRuns]);

  const saveAutomation = async () => {
    const strategyId = automation.strategyId.trim();
    const intervalMinutes = Number(automation.intervalMinutes);
    const maxSignalsPerRun = Number(automation.maxSignalsPerRun);
    const minConfidence = Number(automation.minConfidence);
    if (!strategyId) {
      setScheduleError('Enter a strategy ID before saving.');
      return;
    }
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) {
      setScheduleError('Interval minutes must be a positive number.');
      return;
    }
    if (!Number.isFinite(maxSignalsPerRun) || maxSignalsPerRun < 1) {
      setScheduleError('Max signals per run must be a positive number.');
      return;
    }
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
      setScheduleError('Minimum confidence must be between 0 and 1.');
      return;
    }
    if (savingSchedule) return;
    setSavingSchedule(true);
    setScheduleError('');
    setScheduleNotice('');
    try {
      await strategyAutomationAPI.saveSchedule(strategyId, {
        enabled: automation.enabled,
        intervalMinutes: Math.floor(intervalMinutes),
        maxSignalsPerRun: Math.floor(maxSignalsPerRun),
        minConfidence,
        allowedSymbols: automation.allowedSymbols,
      });
      const summary = `Automation schedule saved for ${strategyId}: every ${Math.floor(intervalMinutes)} minutes, confidence >= ${minConfidence}.`;
      setScheduleNotice(summary);
      setLastAction(summary);
    } catch (error) {
      setScheduleError(errorText(error));
      setLastAction(`Automation schedule save failed: ${errorText(error)}`);
    } finally {
      setSavingSchedule(false);
    }
  };

  const runAutomationNow = async () => {
    const strategyId = automation.strategyId.trim();
    if (!strategyId) {
      setRunOutcome({ tone: 'error', message: 'Enter a strategy ID before running.' });
      return;
    }
    if (running) return;
    setRunning(true);
    setRunOutcome(null);
    try {
      const result = await strategyAutomationAPI.run(strategyId, { auto_execute: false });
      const outcome = describeAutomationRun(result);
      setRunOutcome(outcome);
      setLastAction(`Automation run for ${strategyId}: ${outcome.message}`);
      await loadAutomationRuns(strategyId);
    } catch (error) {
      setRunOutcome({ tone: 'error', message: errorText(error) });
      setLastAction(`Automation run failed: ${errorText(error)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="mb-2 text-slate-100">Operations</h2>
          <p className="max-w-3xl text-slate-400">
            Manage risk, order lifecycle, options orders, strategy automation, and production readiness from one control surface.
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

        {activePanel === 'options' && <OptionsOrderTicket active={active} />}

        {activePanel === 'automation' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Zap className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Schedule Controls</h4>
              </div>
              {schedulesLoading && <p className="mb-4 text-xs text-slate-500">Loading saved schedules…</p>}
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
                <button onClick={() => void saveAutomation()} disabled={savingSchedule} className="w-full rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600">
                  {savingSchedule ? 'Saving…' : 'Save Automation Schedule'}
                </button>
                {scheduleError && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{scheduleError}</p>}
                {scheduleNotice && <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{scheduleNotice}</p>}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-950/30 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-slate-100">Run Now</h4>
                <button onClick={() => void runAutomationNow()} disabled={running} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm text-white transition-colors hover:bg-emerald-600">
                  <Play className="h-4 w-4" />
                  {running ? 'Running…' : 'Run now'}
                </button>
              </div>
              <p className="text-xs text-slate-500">UI runs record orders without submitting them. Broker submission happens only when a run explicitly opts in via auto_execute.</p>
              {runOutcome && (
                <p role={runOutcome.tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 text-sm ${runOutcomeClass[runOutcome.tone]}`}>
                  {runOutcome.message}
                </p>
              )}
              <div className="mb-4 mt-6 flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-400" />
                <h4 className="text-slate-100">Recent runs</h4>
              </div>
              {runsError && <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{runsError}</p>}
              {!runsError && !recentRuns.length && <p className="text-sm text-slate-400">No runs recorded yet for this strategy.</p>}
              <div className="space-y-3">
                {recentRuns.map((run) => (
                  <div key={run.id} className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
                    <div>
                      <p className="text-sm text-slate-100">{run.started_at ? new Date(run.started_at).toLocaleString() : 'Not started'}</p>
                      <p className="mt-1 text-xs text-slate-500">{run.accepted_order_ids?.length ?? 0} accepted · {run.blocked_order_ids?.length ?? 0} blocked</p>
                    </div>
                    <StatusPill status={run.status} />
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

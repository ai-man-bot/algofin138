import { useEffect, useRef, useState } from 'react';
import { alpacaAPI, brokersAPI, optionPlansAPI } from '../utils/api';
import { marketDate } from '../utils/optionWebhook';
import { normalizeOptionTicket, type OptionInstruction } from '../utils/optionTicket';
import { managedPlanLabel, type ManagedOptionPlan } from './optionSignalPresentation';
import { extractAlpacaOptionContracts, extractAlpacaOptionSnapshots, normalizeOptionChainRows, type OptionChainRow } from '../utils/optionChain';
import './OptionsOrderTicket.css';

type Broker = { id: string; name: string; base_url?: string; broker_type?: string; brokerType?: string; connected: boolean };
type Review = { instruction: OptionInstruction; environment: 'paper' | 'live'; broker_id: string; contract_size: number; request_id: string };
const field = 'option-ticket-field';
const button = 'option-ticket-button';
const panel = 'option-ticket-panel';
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
const money = (value: number | null) => value == null ? '—' : `$${value.toFixed(2)}`;

export function OptionsOrderTicket({ active = true }: { active?: boolean }) {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [brokerId, setBrokerId] = useState('');
  const broker = brokers.find(item => item.id === brokerId);
  const environment = broker?.base_url === 'https://paper-api.alpaca.markets' ? 'paper' : broker?.base_url === 'https://api.alpaca.markets' ? 'live' : null;
  const [mode, setMode] = useState<'message' | 'chain'>('message');
  const [message, setMessage] = useState('');
  const [underlying, setUnderlying] = useState('PLTR');
  const [expiration, setExpiration] = useState('');
  const [optionType, setOptionType] = useState('call');
  const [rows, setRows] = useState<OptionChainRow[]>([]);
  const [symbol, setSymbol] = useState('');
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [loadingChain, setLoadingChain] = useState(false);
  const [chainNote, setChainNote] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [submittedId, setSubmittedId] = useState('');
  const [plans, setPlans] = useState<ManagedOptionPlan[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const chainVersion = useRef(0);
  const editVersion = useRef(0);
  const submissionLock = useRef(false);
  const locked = attempted || submitting || reviewing;
  const expirations = [...new Set(rows.map(row => row.expirationDate))].sort();
  const visibleRows = rows.filter(row => row.expirationDate === expiration && row.type === optionType);
  const selected = visibleRows.find(row => row.symbol === symbol);
  const storageKey = `option-ticket-pending:${brokerId}`;

  useEffect(() => {
    let canceled = false;
    brokersAPI.getAll({ forceRefresh: true }).then(data => {
      if (canceled) return;
      setBrokers((Array.isArray(data) ? data : []).filter(item => item.connected && (item.broker_type || item.brokerType) === 'alpaca'));
    }).catch(error => { if (!canceled) setError(errorText(error)); });
    return () => { canceled = true; };
  }, []);

  useEffect(() => {
    setPlans([]); setHistoryError('');
    if (!brokerId || !active) return;
    let canceled = false;
    let running = false;
    async function load() {
      if (running || document.hidden) return;
      running = true;
      try {
        const result = await optionPlansAPI.list(brokerId);
        if (!canceled) { setPlans(result.plans || []); setHistoryError(''); }
      } catch (error) { if (!canceled) setHistoryError(errorText(error)); }
      finally { running = false; }
    }
    void load();
    const timer = window.setInterval(load, 10000);
    return () => { canceled = true; window.clearInterval(timer); };
  }, [brokerId, active, refresh]);

  function edit() { editVersion.current++; setReview(null); setError(''); setSubmittedId(''); }
  function chooseBroker(id: string) {
    edit(); chainVersion.current++; setLoadingChain(false); setRows([]); setSymbol(''); setBrokerId(id);
    setAttempted(false);
    try {
      const saved = JSON.parse(sessionStorage.getItem(`option-ticket-pending:${id}`) || 'null');
      if (saved?.broker_id === id && saved?.request_id && saved?.instruction) {
        setReview(saved); setAttempted(true);
        setError('A previous submission needs confirmation. Retry the same request to recover its result without placing a duplicate.');
      }
    } catch { setError('Could not restore the pending ticket. Check order history before submitting.'); }
  }
  async function loadChain() {
    edit(); const version = ++chainVersion.current;
    setRows([]); setSymbol(''); setChainNote(''); setLoadingChain(true);
    try {
      if (!/^[A-Z]{1,6}$/.test(underlying.trim().toUpperCase())) throw new Error('Enter an underlying ticker');
      const params = { brokerId, expiration_date_gte: marketDate(), expiration_date_lte: '2099-12-31', limit: 1000 };
      const [contracts, snapshots] = await Promise.all([
        alpacaAPI.getOptionContracts(underlying, params, { forceRefresh: true }),
        alpacaAPI.getOptionChain(underlying, { brokerId, feed: 'indicative', limit: 1000 }, { forceRefresh: true }).catch(() => null),
      ]);
      if (version !== chainVersion.current) return;
      const next = normalizeOptionChainRows(extractAlpacaOptionContracts(contracts), extractAlpacaOptionSnapshots(snapshots || {}));
      setRows(next); setExpiration(next[0]?.expirationDate || '');
      setChainNote(next.length ? 'Indicative quotes are reference prices, not guaranteed fills. Enter your own limit prices.' : 'No contracts returned. Try another underlying.');
      if (contracts.next_page_token) setChainNote('Showing the first 1,000 contracts. Use the message ticket if your contract is not listed. Quotes are indicative.');
    } catch (error) { if (version === chainVersion.current) setError(errorText(error)); }
    finally { if (version === chainVersion.current) setLoadingChain(false); }
  }
  async function reviewTicket() {
    if (!environment || !brokerId) return;
    const version = editVersion.current;
    setError(''); setReviewing(true);
    try {
      if (mode === 'chain' && (!selected || !selected.tradable)) throw new Error('Select a tradable contract from the fetched chain');
      const input = mode === 'message' ? { message } : { symbol, entry_price: entry, target_price: target };
      normalizeOptionTicket(input);
      const result = await optionPlansAPI.preview({ ...input, broker_id: brokerId, environment });
      if (version === editVersion.current) setReview({ ...result, request_id: crypto.randomUUID() });
    } catch (error) { if (version === editVersion.current) setError(errorText(error)); }
    finally { setReviewing(false); }
  }
  async function submit() {
    if (!review || submissionLock.current || submittedId) return;
    submissionLock.current = true; setSubmitting(true); setError('');
    try {
      // Persist the same identity before sending, so a lost response can be retried.
      sessionStorage.setItem(storageKey, JSON.stringify(review));
      setAttempted(true);
      const result = await optionPlansAPI.submit({
        symbol: review.instruction.symbol, entry_price: review.instruction.entry_price,
        target_price: review.instruction.target_price, broker_id: review.broker_id,
        environment: review.environment, request_id: review.request_id,
      });
      setSubmittedId(result.plan.id); sessionStorage.removeItem(storageKey);
      setRefresh(value => value + 1);
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (!attempted && status && [400, 401, 409, 503].includes(status)) {
        sessionStorage.removeItem(storageKey); setAttempted(false); setReview(null);
        setError(`${errorText(error)}. No plan was accepted by this request; review the ticket again.`);
      } else {
        setError(`${errorText(error)}. Retry this same ticket to confirm the outcome; its request ID will be reused.`);
      }
    }
    finally { submissionLock.current = false; setSubmitting(false); }
  }

  return <div className="option-ticket space-y-6">
    <div className={panel}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-semibold text-slate-100">Options order ticket</h3><p className="mt-1 text-sm text-slate-400">Buy 3 contracts. Take the first target on 1 contract.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${environment === 'live' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/15 text-blue-300'}`}>{environment ? `${environment.toUpperCase()} ACCOUNT` : 'SELECT AN ACCOUNT'}</span>
      </div>
      <label className="block max-w-xl text-sm text-slate-300">Alpaca account
        <select className={`${field} mt-2`} value={brokerId} disabled={locked} onChange={event => chooseBroker(event.target.value)}>
          <option value="">Select an account</option>
          {brokers.map(item => <option key={item.id} value={item.id}>{item.name || 'Alpaca'} — {item.base_url?.includes('paper-api') ? 'Paper' : 'Live'} — {item.id}</option>)}
        </select>
      </label>
      {!brokers.length && <p className="mt-2 text-sm text-slate-400">A connected Alpaca account is required. Connections are managed in Brokers.</p>}
      <fieldset disabled={locked} className="mt-5 space-y-4">
        <legend className="sr-only">Order input</legend>
        <div className="flex gap-2" aria-label="Order entry method">
          {(['message', 'chain'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { edit(); setMode(value); }} className={`rounded-lg border px-4 py-2 text-sm ${mode === value ? 'border-blue-400 bg-blue-500/15 text-blue-200' : 'border-slate-600 text-slate-300'}`}>{value === 'message' ? 'Paste option message' : 'Select from chain'}</button>)}
        </div>
        {mode === 'message' ? <label className="block text-sm text-slate-300">Option message
          <textarea className={`${field} mt-2 min-h-28 font-mono text-sm`} value={message} onChange={event => { edit(); setMessage(event.target.value); }} placeholder="PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65" />
          <span className="mt-2 block text-xs text-slate-400">Dates use New York time; a date that has passed resolves to next year. Review the resolved year below.</span>
        </label> : <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm text-slate-300">Underlying<input className={`${field} mt-2`} value={underlying} onChange={event => { edit(); chainVersion.current++; setLoadingChain(false); setRows([]); setSymbol(''); setUnderlying(event.target.value.toUpperCase()); }} /></label>
            <button type="button" className={button} onClick={loadChain} disabled={!environment || loadingChain}>{loadingChain ? 'Loading contracts…' : 'Load option chain'}</button></div>
          {rows.length > 0 && <>
            <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-300">Expiration<select className={`${field} mt-2`} value={expiration} onChange={event => { edit(); setExpiration(event.target.value); setSymbol(''); }}>{expirations.map(date => <option key={date}>{date}</option>)}</select></label>
              <label className="text-sm text-slate-300">Contract type<select className={`${field} mt-2`} value={optionType} onChange={event => { edit(); setOptionType(event.target.value); setSymbol(''); }}><option value="call">Calls</option><option value="put">Puts</option></select></label></div>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-700"><table className="w-full text-left text-sm"><caption className="sr-only">Select a tradable option contract</caption><thead className="sticky top-0 bg-slate-900 text-slate-400"><tr><th className="p-3">Contract</th><th>Strike</th><th>Bid</th><th>Ask</th></tr></thead><tbody>{visibleRows.map(row => <tr key={row.symbol} className={symbol === row.symbol ? 'bg-blue-500/15' : ''}><td className="p-3"><label className="flex items-center gap-2 text-slate-200"><input type="radio" name="option-contract" checked={symbol === row.symbol} disabled={!row.tradable} onChange={() => { edit(); setSymbol(row.symbol); }} /><span className="font-mono">{row.symbol}{!row.tradable ? ' (not tradable)' : ''}</span></label></td><td className="text-slate-200">{row.strikePrice}</td><td className="text-slate-300">{money(row.bid)}</td><td className="text-slate-300">{money(row.ask)}</td></tr>)}</tbody></table></div>
          </>}
          {chainNote && <p className="text-xs text-slate-400">{chainNote}</p>}
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-300">Entry limit price ($)<input className={`${field} mt-2`} inputMode="decimal" value={entry} onChange={event => { edit(); setEntry(event.target.value); }} /></label><label className="text-sm text-slate-300">First target price ($)<input className={`${field} mt-2`} inputMode="decimal" value={target} onChange={event => { edit(); setTarget(event.target.value); }} /></label></div>
        </div>}
      </fieldset>
      {!attempted && <button type="button" className={`${button} mt-4`} disabled={!environment || reviewing || loadingChain} onClick={reviewTicket}>{reviewing ? 'Validating contract…' : 'Review order'}</button>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
    </div>
    {review && <div className={`${panel} border-blue-500/40`} aria-label="Order review">
      <h3 className="text-lg font-semibold text-slate-100">Review {review.environment} order</h3>
      <p className="mt-2 font-mono text-blue-300">{review.instruction.symbol}</p>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-400">Expiration</dt><dd className="text-slate-100">{review.instruction.expiration}</dd></div>
        <div><dt className="text-slate-400">Entry · DAY limit</dt><dd className="text-slate-100">Buy to open 3 @ ${review.instruction.entry_price}</dd></div>
        <div><dt className="text-slate-400">First target · GTC limit</dt><dd className="text-slate-100">Sell to close 1 @ ${review.instruction.target_price}</dd></div>
        <div><dt className="text-slate-400">Entry premium at limit</dt><dd className="text-slate-100">{money(Number(review.instruction.entry_price) * 3 * review.contract_size)} before fees</dd></div>
      </dl>
      <p className="mt-4 text-sm text-slate-400">The target is submitted after at least one entry contract fills. Two contracts remain only after all three entry contracts and the first target fill. Outside market hours, accepted orders await an eligible session; limit prices do not guarantee a fill.</p>
      {submittedId ? <div role="status" className="mt-4 text-sm text-emerald-300"><p>Plan received: {submittedId}. This is not a fill confirmation.</p><button type="button" className={`${button} mt-3`} onClick={() => { setAttempted(false); setSubmittedId(''); setReview(null); setMessage(''); setEntry(''); setTarget(''); }}>Start another ticket</button></div> : <button type="button" className={`${button} mt-4`} disabled={submitting} onClick={submit}>{submitting ? 'Submitting…' : attempted ? 'Retry same submission' : `Submit ${review.environment} order`}</button>}
    </div>}
    <div className={panel}>
      <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold text-slate-100">Option plans</h3><button type="button" className={button} disabled={!brokerId} onClick={() => setRefresh(value => value + 1)}>Refresh plans</button></div>
      <p className="mt-1 text-xs text-slate-400">Latest 50 plans for this account, including webhook messages. Updates every 10 seconds while visible.</p>
      {historyError && <p role="alert" className="mt-3 text-rose-300">{historyError}</p>}
      {!plans.length ? <p className="mt-4 text-sm text-slate-400">{brokerId ? 'No option plans loaded.' : 'Select an account to view its plans.'}</p> : <ul className="mt-4 space-y-3">{plans.map(plan => <li key={plan.id} className="rounded-lg border border-slate-700 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-slate-100">{plan.symbol}</span><span className={plan.status === 'needs_attention' || plan.status === 'entry_terminal' ? 'text-amber-300' : 'text-blue-300'}>{managedPlanLabel(plan)}</span></div><p className="mt-2 text-slate-300">Entry ${Number(plan.entry_price).toFixed(2)} · Filled {Number(plan.entry_filled_qty)} / 3 · Target ${Number(plan.target_price).toFixed(2)} · Filled {Number(plan.target_filled_qty)} / 1 · Other exit fills {Number(plan.management?.exit_filled_qty || 0)} · Stop {plan.management?.stop_price ? `$${Number(plan.management.stop_price).toFixed(2)}` : '—'} · Remaining {Math.max(0, Number(plan.entry_filled_qty) - Number(plan.target_filled_qty) - Number(plan.management?.exit_filled_qty || 0))}</p><p className="mt-1 break-all text-xs text-slate-500">Plan {plan.id} · {new Date(plan.created_at).toLocaleString()}{plan.entry_order_id ? ` · Entry order ${plan.entry_order_id}` : ''}{plan.target_order_id ? ` · Target order ${plan.target_order_id}` : ''}</p>{plan.last_error && <p className="mt-2 text-amber-300">{plan.last_error}</p>}</li>)}</ul>}
    </div>
  </div>;
}

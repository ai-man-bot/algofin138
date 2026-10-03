import { useCallback, useEffect, useRef, useState } from 'react';
import { brokersAPI, webhooksAPI } from '../utils/api';
import { sendWebhookTest } from '../utils/webhookTest';
import './OptionsOrderTicket.css';

type Route = { id: string; name: string; status: string; url: string; broker_id: string; environment: string | null; connection_error?: string; strategyId?: string };
type Broker = { id: string; name?: string; connected: boolean; broker_type?: string; brokerType?: string; base_url?: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
const field = 'option-ticket-field', button = 'option-ticket-button', panel = 'option-ticket-panel';
const example = 'PLTR: 190P 10/16: BTO Buy to open at 6.65 with first target above 7.65';
const environmentOf = (broker?: Broker) => broker?.base_url === 'https://paper-api.alpaca.markets' ? 'paper' : broker?.base_url === 'https://api.alpaca.markets' ? 'live' : null;

export function WebhooksPage() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Route | 'new' | null>(null);
  const [name, setName] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [status, setStatus] = useState('active');
  const [previewRoute, setPreviewRoute] = useState<Route | null>(null);
  const [payload, setPayload] = useState(example);
  const [preview, setPreview] = useState<any>(null);
  const [testRoute, setTestRoute] = useState<Route | null>(null);
  const [testPayload, setTestPayload] = useState('');
  const [contentType, setContentType] = useState('application/json');
  const [testResult, setTestResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const broker = brokers.find(item => item.id === brokerId);
  const environment = environmentOf(broker);

  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled([
      webhooksAPI.getAll({ forceRefresh: true }), brokersAPI.getAll({ forceRefresh: true }),
      webhooksAPI.getAllEvents({ forceRefresh: true }),
    ]);
    if (version !== generation.current) return;
    if (results[0].status === 'fulfilled') setRoutes(results[0].value || []);
    if (results[1].status === 'fulfilled') setBrokers((results[1].value || []).filter((item: Broker) => item.connected && (item.broker_type || item.brokerType) === 'alpaca'));
    if (results[2].status === 'fulfilled') setEvents(results[2].value || []);
    setLoadError(results.flatMap((result, index) => result.status === 'rejected' ? [`${['Webhooks', 'Accounts', 'Events'][index]}: ${errorText(result.reason)}`] : []).join(' · '));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  function edit(route: Route | 'new') {
    setEditor(route); setPreviewRoute(null); setTestRoute(null); setError(''); setNotice('');
    setName(route === 'new' ? '' : route.name);
    setBrokerId(route === 'new' ? '' : route.broker_id);
    setStatus(route === 'new' ? 'active' : route.status);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || !environment || mutation.current) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      const values = { name, broker_id: brokerId, environment, status };
      if (editor === 'new') await webhooksAPI.create(values); else await webhooksAPI.update(editor.id, values);
      setEditor(null); setNotice('Webhook saved. No order was placed.'); await load();
    } catch (error) { setError(errorText(error)); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function deactivate(route: Route) {
    if (mutation.current) return;
    if (!window.confirm(`Deactivate ${route.name}? Future signals will be rejected. Existing orders and option plans will continue.`)) return;
    mutation.current = true; setBusy(true); setError('');
    try { await webhooksAPI.update(route.id, { status: 'inactive' }); setNotice('Webhook deactivated. Existing plans continue to reconcile.'); await load(); }
    catch (error) { setError(errorText(error)); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function previewMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!previewRoute || mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setPreview(null);
    try { setPreview(await webhooksAPI.preview(previewRoute.id, payload)); }
    catch (error) { setError(errorText(error)); }
    finally { mutation.current = false; setBusy(false); }
  }

  async function remove(route: Route) {
    if (mutation.current || !window.confirm(`Delete ${route.name}? This URL will stop working permanently. Existing orders, option plans, and history are retained.`)) return;
    mutation.current = true; setBusy(true); setError('');
    try {
      await webhooksAPI.delete(route.id);
      setTestRoute(null); setPreviewRoute(null); setEditor(null);
      setNotice('Webhook deleted. Existing orders and history were retained.'); await load();
    } catch (error) { setError(errorText(error)); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function deliverTest(event: React.FormEvent) {
    event.preventDefault();
    if (!testRoute || mutation.current) return;
    if (!window.confirm(`Send this payload to ${testRoute.name} (${testRoute.environment?.toUpperCase() || 'unknown account'})? A valid signal can place an order on this account.`)) return;
    mutation.current = true; setBusy(true); setError(''); setTestResult(null);
    try { setTestResult(await sendWebhookTest(testRoute.url, testPayload, contentType)); }
    catch (error) { setError(errorText(error)); }
    finally { await load(); mutation.current = false; setBusy(false); }
  }

  return <div className="option-ticket mx-auto max-w-[1600px] px-6 py-8">
    <div className="flex justify-between"><div><h2>Webhooks</h2><p>Receive option messages or JSON trade signals through a tokenized account route.</p></div>
      <div className="flex"><button className={button} disabled={busy} onClick={() => edit('new')}>Create webhook</button><button className={button} disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh webhooks'}</button></div></div>
    {loadError && <p role="alert">Could not load webhook data. {loadError}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {editor && <form className={panel} onSubmit={save} aria-label="Webhook editor">
      <h3>{editor === 'new' ? 'Create webhook' : 'Edit webhook'}</h3>
      <fieldset disabled={busy}>
        <label>Webhook name<input className={field} required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Alpaca account<select className={field} required value={brokerId} onChange={event => setBrokerId(event.target.value)}><option value="">Select an account</option>
          {brokerId && !brokers.some(item => item.id === brokerId) && <option value={brokerId} disabled>Unavailable account — choose another</option>}
          {brokers.map(item => <option key={item.id} value={item.id}>{item.name || 'Alpaca'} — {environmentOf(item) || 'Unknown environment'} — {item.id}</option>)}
        </select></label>
        <label>Status<select className={field} value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </fieldset>
      <p>{environment ? `New signals will use this ${environment.toUpperCase()} account.` : 'Select a connected Alpaca account.'} Existing plans keep their original account. Deactivation does not cancel existing orders.</p>
      {editor !== 'new' && editor.strategyId && <p>Existing strategy association will be preserved.</p>}
      <div className="flex"><button type="submit" className={button} disabled={busy || !environment}>{busy ? 'Saving…' : 'Save webhook'}</button><button type="button" className={button} disabled={busy} onClick={() => setEditor(null)}>Cancel</button></div>
    </form>}
    {!routes.length && !loading && <p>{loadError ? 'Webhook data unavailable.' : 'No webhooks yet. Create a route for the account that should receive your signals.'}</p>}
    {routes.map(route => <section key={route.id} className={panel} aria-label={route.name}>
      <div className="flex justify-between"><h3>{route.name}</h3><span>{route.status.toUpperCase()} · {route.environment?.toUpperCase() || 'ACCOUNT UNAVAILABLE'}</span></div>
      <p>Account: {route.broker_id || 'Not selected'}</p>
      {route.connection_error && <p role="alert">{route.connection_error}</p>}
      <label>Webhook URL<input className={`${field} font-mono`} readOnly value={route.url} onFocus={event => event.target.select()} /></label>
      <p>Keep this URL private. Posting a valid signal to an active route can place an order on the account above.</p>
      <div className="flex">
        <button className={button} onClick={async () => { try { await navigator.clipboard.writeText(route.url); setNotice('Webhook URL copied.'); } catch { setError('Clipboard unavailable. Select the webhook URL and copy it manually.'); } }}>Copy URL</button>
        <button className={button} disabled={busy} onClick={() => edit(route)}>Edit webhook</button>
        <button className={button} disabled={busy} onClick={() => { setTestRoute(route); setPreviewRoute(null); setEditor(null); setContentType('application/json'); setTestPayload(JSON.stringify({ event_id: crypto.randomUUID(), message: example }, null, 2)); setTestResult(null); setError(''); }}>Test Webhook</button>
        <button className={button} disabled={busy || !!route.connection_error} onClick={() => { setPreviewRoute(route); setTestRoute(null); setEditor(null); setPayload(example); setPreview(null); setError(''); }}>Preview message</button>
        <button className={button} disabled={busy || route.status !== 'active'} onClick={() => void deactivate(route)}>Deactivate</button>
        <button className={button} disabled={busy} onClick={() => void remove(route)}>Delete webhook</button>
      </div>
    </section>)}
    {testRoute && <form className={panel} onSubmit={deliverTest} aria-label="Webhook test">
      <h3>Test Webhook · {testRoute.name}</h3>
      <p>POST to this webhook using {testRoute.environment?.toUpperCase() || 'the configured'} account {testRoute.broker_id}. Valid signals can place orders. HTTP 202 means queued, not filled.</p>
      <label>Content type<select className={field} disabled={busy} value={contentType} onChange={event => setContentType(event.target.value)}><option value="application/json">JSON</option><option value="text/plain">Plain text</option></select></label>
      <label>Test payload<textarea className={field} rows={6} required disabled={busy} value={testPayload} onChange={event => setTestPayload(event.target.value)} /></label>
      <p>Reuse event_id when retrying the same signal. Use a new event_id only for a new intended order.</p>
      <button className={button} disabled={busy}>{busy ? 'Sending…' : 'Send test request'}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setTestRoute(null)}>Close test</button>
      {testResult && <div role="status"><p>HTTP {testResult.status} · {testResult.ok ? 'Request received' : 'Request rejected'}</p><pre className="overflow-x-auto text-sm">{JSON.stringify(testResult.body, null, 2)}</pre></div>}
    </form>}
    {previewRoute && <form className={panel} onSubmit={previewMessage} aria-label="Webhook message preview">
      <h3>Preview message · {previewRoute.name}</h3><p>This validates the message and option contract. It does not submit an order or create a trade plan.</p>
      <label>Option message or JSON<textarea className={field} disabled={busy} value={payload} onChange={event => { setPayload(event.target.value); setPreview(null); }} /></label>
      <div className="flex"><button className={button} disabled={busy}>{busy ? 'Validating…' : 'Validate message'}</button><button type="button" className={button} disabled={busy} onClick={() => setPreviewRoute(null)}>Close preview</button></div>
      {preview && <div role="status"><p>{preview.executable === false ? preview.reason || 'This message needs review or configuration.' : 'Message parsed. No order placed. Broker acceptance, account eligibility, and runtime risk checks are not verified by preview.'}</p>
        <pre className="overflow-x-auto text-sm">{JSON.stringify(preview, null, 2)}</pre></div>}
    </form>}
    <section className={panel}>
      <h3>Recent events</h3><p>Latest 100 webhook requests and option plans. Receipt or broker acceptance does not imply a fill. Full option plan and target status is available in Operations.</p>
      {!events.length ? <p>{loadError ? 'Event data may be unavailable.' : 'No webhook events yet.'}</p> : <div className="overflow-x-auto"><table><thead><tr>{['Webhook', 'Received', 'Symbol', 'Type', 'Side', 'Qty', 'Filled qty', 'Average fill', 'Status', 'Incoming message', 'Error'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {events.map(event => <tr key={event.id}><td>{event.webhook}</td><td>{event.timestamp ? new Date(event.timestamp).toLocaleString() : '—'}</td><td>{event.payload?.symbol || '—'}</td><td>{event.alpacaOrder?.type || event.payload?.type || '—'}</td><td>{event.payload?.action || '—'}</td><td>{event.payload?.quantity ?? '—'}</td><td>{event.alpacaOrder?.filled_qty ?? '—'}</td><td>{event.alpacaOrder?.filled_avg_price ?? '—'}</td><td>{event.alpacaOrder?.status || event.status || 'Unknown'}</td><td>{event.receivedMessage ? <details><summary>View message</summary><pre className="whitespace-pre-wrap break-words max-w-lg text-sm">{event.receivedMessage}</pre></details> : '—'}</td><td>{event.error || '—'}</td></tr>)}
      </tbody></table></div>}
    </section>
  </div>;
}

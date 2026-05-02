import { useEffect, useState } from 'react';
import { X, Send, CheckCircle2 } from './CustomIcons';
import { getAccessToken } from '../utils/api';
import { publicAnonKey } from '../utils/supabase/info';
import { buildFunctionUrl } from '../utils/supabaseUrls';

type Broker = {
  id: string;
  name?: string;
  brokerType?: string;
  broker_type?: string;
  accountId?: string;
  account_id?: string;
  connected?: boolean;
  paper?: boolean;
};

type ParsedOrder = {
  symbol: string;
  side: 'buy' | 'sell';
  qty?: number;
  notional?: number;
  order_type: string;
  time_in_force: string;
  asset_type?: 'equity' | 'crypto';
  intent?: string;
  requires_confirmation?: boolean;
};

function authHeaders() {
  const token = getAccessToken() || publicAnonKey;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function normalizeBroker(broker: any): Broker {
  return {
    ...broker,
    brokerType: broker?.brokerType || broker?.broker_type || 'alpaca',
    accountId: broker?.accountId || broker?.account_id || broker?.metadata?.account?.id || 'N/A',
  };
}

export function TradeAssistant({ onClose, onExecuted }: { onClose?: () => void; onExecuted?: () => void }) {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [brokerAccountId, setBrokerAccountId] = useState('');
  const [input, setInput] = useState('');
  const [requestId, setRequestId] = useState('');
  const [parsedOrder, setParsedOrder] = useState<ParsedOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    loadBrokers();
  }, []);

  async function loadBrokers() {
    try {
      const response = await fetch(buildFunctionUrl('/brokers'), {
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load brokers');
      const normalized = (data || []).map(normalizeBroker).filter((broker: Broker) => {
        return (broker.brokerType || broker.broker_type) === 'alpaca' && broker.connected !== false;
      });
      setBrokers(normalized);
      if (normalized.length > 0) setBrokerAccountId(normalized[0].id);
    } catch (err: any) {
      setError(err.message || 'Failed to load brokers');
    }
  }

  async function parseOrder() {
    setLoading(true);
    setError('');
    setResult(null);
    setParsedOrder(null);
    setRequestId('');

    try {
      const response = await fetch(buildFunctionUrl('/trade-assistant/parse'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input, broker_account_id: brokerAccountId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to parse order');
      setParsedOrder(data.parsed_order);
      setRequestId(data.request_id);
    } catch (err: any) {
      setError(err.message || 'Failed to parse order');
    } finally {
      setLoading(false);
    }
  }

  async function confirmOrder() {
    if (!requestId) return;
    setExecuting(true);
    setError('');

    try {
      const response = await fetch(buildFunctionUrl('/trade-assistant/confirm'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ request_id: requestId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to execute order');
      setResult(data);
      onExecuted?.();
    } catch (err: any) {
      setError(err.message || 'Failed to execute order');
    } finally {
      setExecuting(false);
    }
  }

  const selectedBroker = brokers.find((broker) => broker.id === brokerAccountId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-slate-200">
          <X className="h-5 w-5" />
        </button>

        <h3 className="mb-1 text-slate-100">Trade Assistant</h3>
        <p className="mb-5 text-sm text-slate-400">
          Type a plain-English paper-trading instruction. You will review before the order is submitted.
        </p>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-slate-300">Alpaca Account</label>
          <select
            value={brokerAccountId}
            onChange={(event) => setBrokerAccountId(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-white outline-none focus:border-blue-500"
          >
            {brokers.length === 0 ? (
              <option value="">No connected Alpaca account</option>
            ) : (
              brokers.map((broker) => (
                <option key={broker.id} value={broker.id}>
                  {broker.name || 'Alpaca'} - {broker.accountId || broker.account_id || 'N/A'} {broker.paper ? '(Paper)' : '(Live)'}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="mb-4">
          <label className="mb-2 block text-sm text-slate-300">Instruction</label>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={4}
            placeholder="Example: Buy 5 shares of TQQQ at market"
            className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none focus:border-blue-500"
          />
        </div>

        {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}

        {parsedOrder && (
          <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
            <h4 className="mb-3 text-sm text-blue-300">Review Parsed Order</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400">Side:</span> <span className="font-mono text-slate-100">{parsedOrder.side.toUpperCase()}</span></div>
              <div><span className="text-slate-400">Symbol:</span> <span className="font-mono text-slate-100">{parsedOrder.symbol}</span></div>
              <div><span className="text-slate-400">Quantity:</span> <span className="font-mono text-slate-100">{parsedOrder.qty ?? 'N/A'}</span></div>
              <div><span className="text-slate-400">Notional:</span> <span className="font-mono text-slate-100">{parsedOrder.notional ? `$${parsedOrder.notional}` : 'N/A'}</span></div>
              <div><span className="text-slate-400">Order:</span> <span className="font-mono text-slate-100">{parsedOrder.order_type}</span></div>
              <div><span className="text-slate-400">TIF:</span> <span className="font-mono text-slate-100">{parsedOrder.time_in_force}</span></div>
            </div>
            <p className="mt-3 text-xs text-yellow-300">Confirming will submit this order to {selectedBroker?.name || 'Alpaca'}.</p>
          </div>
        )}

        {result && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Order submitted. Status: {result?.alpaca_order?.status || 'submitted'}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
          {!parsedOrder ? (
            <button
              onClick={parseOrder}
              disabled={loading || !input.trim() || !brokerAccountId}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-500 py-3 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {loading ? 'Parsing...' : 'Parse Order'}
            </button>
          ) : (
            <button
              onClick={confirmOrder}
              disabled={executing || !!result}
              className="flex-1 rounded-lg bg-emerald-500 py-3 text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {executing ? 'Submitting...' : result ? 'Submitted' : 'Confirm Order'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

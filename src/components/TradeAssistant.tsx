import { useState } from 'react';
import { X, CheckCircle2 } from './CustomIcons';
import { tradeAssistantAPI } from '../utils/api';

type ParsedOrder = {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  order_type: string;
  time_in_force: string;
  broker_account_id?: string;
};

export function TradeAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [parsedOrder, setParsedOrder] = useState<ParsedOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setInput('');
    setRequestId(null);
    setParsedOrder(null);
    setLoading(false);
    setConfirming(false);
    setMessage('');
    setError('');
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const handleParse = async () => {
    if (!input.trim()) {
      setError('Enter a trade instruction first.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setMessage('');

      const result = await tradeAssistantAPI.parse(input.trim());

      setRequestId(result.request_id || result.id);
      setParsedOrder(result.parsed_order || result.order || result);
      setMessage('Order parsed. Review and confirm before submitting.');
    } catch (err: any) {
      setError(err.message || 'Failed to parse trade instruction.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!requestId) {
      setError('Missing request ID. Parse the order again.');
      return;
    }

    try {
      setConfirming(true);
      setError('');
      setMessage('');

      const result = await tradeAssistantAPI.confirm(requestId);

      setMessage(
        result?.alpaca_order?.id
          ? `Order submitted to Alpaca. Order ID: ${result.alpaca_order.id}`
          : 'Order submitted successfully.'
      );

      setParsedOrder(null);
      setRequestId(null);
      setInput('');
    } catch (err: any) {
      setError(err.message || 'Failed to confirm trade.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600"
      >
        Trade Assistant
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl">
            <button
              onClick={close}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="mb-2 text-slate-100">Trade Assistant</h3>
            <p className="mb-5 text-sm text-slate-400">
              Enter a plain-English trade instruction. You will review it before anything is sent to Alpaca.
            </p>

            <div className="space-y-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Example: Buy 1 TQQQ at market"
                className="min-h-[110px] w-full rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500"
              />

              <div className="flex gap-3">
                <button
                  onClick={handleParse}
                  disabled={loading || confirming}
                  className="flex-1 rounded-lg bg-blue-500 py-3 text-sm text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Parsing...' : 'Parse Order'}
                </button>

                <button
                  onClick={reset}
                  disabled={loading || confirming}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-sm text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
              </div>

              {parsedOrder && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <div className="mb-3 flex items-center gap-2 text-emerald-400">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="text-sm font-medium">Parsed Order</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Symbol</p>
                      <p className="font-mono text-slate-100">{parsedOrder.symbol}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Side</p>
                      <p className="font-mono uppercase text-slate-100">{parsedOrder.side}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Quantity</p>
                      <p className="font-mono text-slate-100">{parsedOrder.qty}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Order Type</p>
                      <p className="font-mono uppercase text-slate-100">{parsedOrder.order_type}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Time in Force</p>
                      <p className="font-mono uppercase text-slate-100">{parsedOrder.time_in_force}</p>
                    </div>
                  </div>

                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className="mt-4 w-full rounded-lg bg-emerald-500 py-3 text-sm text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirming ? 'Submitting...' : 'Confirm & Submit to Alpaca'}
                  </button>
                </div>
              )}

              {message && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                  {message}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-400">
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
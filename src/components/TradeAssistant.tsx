import { useState } from 'react';
import { X, CheckCircle2 } from './CustomIcons';
import { tradeAssistantAPI } from '../utils/api';

type ParsedOrder = {
  intent?: string;
  asset_class?: 'equity' | 'option' | 'crypto';
  source_type?: string;
  symbol: string;
  underlying_symbol?: string;
  option_symbol?: string;
  option_type?: 'call' | 'put';
  expiration_date?: string;
  strike_price?: number;
  side: 'buy' | 'sell';
  position_intent?: 'buy_to_open' | 'sell_to_close';
  qty: number | null;
  requires_quantity?: boolean;
  order_type: string;
  limit_price?: number | null;
  time_in_force: string;
  entry_price?: number | null;
  target_price?: number | null;
  stop_price?: number | null;
  target_percent?: number | null;
  warnings?: string[];
  confidence?: number;
};

export function TradeAssistant() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [parsedOrder, setParsedOrder] = useState<ParsedOrder | null>(null);
  const [overrideQty, setOverrideQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setInput('');
    setRequestId(null);
    setParsedOrder(null);
    setOverrideQty('');
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

      const order = result.parsed_order || result.order || result;
      setRequestId(result.request_id || result.id);
      setParsedOrder(order);
      setOverrideQty(order.qty ? String(order.qty) : '');
      setMessage('Order parsed. Review carefully before submitting.');
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

    if (parsedOrder?.requires_quantity && !overrideQty) {
      setError('Quantity is required for this order before submitting.');
      return;
    }

    try {
      setConfirming(true);
      setError('');
      setMessage('');

      const result = await tradeAssistantAPI.confirm(requestId, {
        qty: overrideQty ? Number(overrideQty) : undefined,
      });

      setMessage(
        result?.alpaca_order?.id
          ? `Order submitted to Alpaca. Order ID: ${result.alpaca_order.id}`
          : 'Order submitted successfully.'
      );

      setParsedOrder(null);
      setRequestId(null);
      setInput('');
      setOverrideQty('');
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
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl">
            <button
              onClick={close}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="mb-2 text-slate-100">Trade Assistant</h3>
            <p className="mb-5 text-sm text-slate-400">
              Paste a stock/options signal or plain-English order. Nothing is sent to Alpaca until confirmation.
            </p>

            <div className="space-y-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Examples:
GOOGL 392.5C 5/8: BTOBuy To Open at 2.25 with first target above 2.59
MSFT: BTOBuy To Open at 402.26 with first target above 410.31
GOOGL 392.5C 05/08 : STCReached Target 3.10 and that's 37.78%! Raise the stops to 2.25`}
                className="min-h-[140px] w-full rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500"
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

                  <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                    <Field label="Asset Class" value={parsedOrder.asset_class || 'N/A'} />
                    <Field label="Symbol" value={parsedOrder.symbol} />
                    <Field label="Side" value={parsedOrder.side?.toUpperCase()} />
                    <Field label="Intent" value={parsedOrder.position_intent || parsedOrder.intent || 'N/A'} />
                    <Field label="Order Type" value={parsedOrder.order_type?.toUpperCase()} />
                    <Field label="TIF" value={parsedOrder.time_in_force?.toUpperCase()} />

                    {parsedOrder.asset_class === 'option' && (
                      <>
                        <Field label="Underlying" value={parsedOrder.underlying_symbol || 'N/A'} />
                        <Field label="Expiration" value={parsedOrder.expiration_date || 'N/A'} />
                        <Field label="Strike" value={parsedOrder.strike_price ?? 'N/A'} />
                        <Field label="Type" value={parsedOrder.option_type || 'N/A'} />
                      </>
                    )}

                    {parsedOrder.limit_price != null && (
                      <Field label="Limit Price" value={`$${Number(parsedOrder.limit_price).toFixed(2)}`} />
                    )}
                    {parsedOrder.target_price != null && (
                      <Field label="Target" value={`$${Number(parsedOrder.target_price).toFixed(2)}`} />
                    )}
                    {parsedOrder.stop_price != null && (
                      <Field label="Stop" value={`$${Number(parsedOrder.stop_price).toFixed(2)}`} />
                    )}
                    {parsedOrder.target_percent != null && (
                      <Field label="Target %" value={`${Number(parsedOrder.target_percent).toFixed(2)}%`} />
                    )}
                  </div>

                  <div className="mt-4">
                    <label className="mb-2 block text-xs text-slate-400">
                      Quantity {parsedOrder.requires_quantity ? '(required)' : ''}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={overrideQty}
                      onChange={(e) => setOverrideQty(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 font-mono text-white outline-none focus:border-blue-500"
                      placeholder="Enter quantity"
                    />
                  </div>

                  {parsedOrder.warnings && parsedOrder.warnings.length > 0 && (
                    <div className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
                      {parsedOrder.warnings.map((warning, index) => (
                        <p key={index}>⚠️ {warning}</p>
                      ))}
                    </div>
                  )}

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

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="break-all font-mono text-slate-100">{String(value)}</p>
    </div>
  );
}

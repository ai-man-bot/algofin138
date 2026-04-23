import { useState, useEffect } from 'react';
import { Copy, Check, TrendingUp, DollarSign, Clock } from './CustomIcons';
import { strategiesAPI } from '../utils/api';

// Fallback copy function that works without clipboard permissions
const copyToClipboard = (text: string, onSuccess: () => void) => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    onSuccess();
  } catch (err) {
    console.error('Failed to copy:', err);
    alert('Failed to copy. Please copy manually: ' + text);
  }
  document.body.removeChild(textarea);
};

interface Strategy {
  id: string;
  name: string;
  tradingViewEnabled?: boolean;
  webhookUrl?: string;
  webhookToken?: string;
}

interface Trade {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  price?: number;
  status: string;
  filledQty: number;
  filledAvgPrice?: number;
  createdAt: string;
  strategyName: string;
}

interface StrategyTradingViewPanelProps {
  strategy: Strategy;
  onUpdate: () => void;
}

export function StrategyTradingViewPanel({ strategy, onUpdate }: StrategyTradingViewPanelProps) {
  const [enabling, setEnabling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'all'>('all');

  useEffect(() => {
    if (strategy.tradingViewEnabled) {
      loadTrades();
    }
  }, [strategy.id, strategy.tradingViewEnabled]);

  const loadTrades = async () => {
    try {
      setLoadingTrades(true);
      const data = await strategiesAPI.getTrades(strategy.id);
      setTrades(data || []);
    } catch (error) {
      console.error('Error loading trades:', error);
      setTrades([]);
    } finally {
      setLoadingTrades(false);
    }
  };

  const handleEnableTradingView = async () => {
    try {
      setEnabling(true);
      await strategiesAPI.enableTradingView(strategy.id);
      console.log('✅ TradingView webhook enabled');
      onUpdate();
    } catch (error) {
      console.error('Error enabling TradingView:', error);
      alert('Failed to enable TradingView webhook');
    } finally {
      setEnabling(false);
    }
  };

  const handleDisableTradingView = async () => {
    if (!confirm('Are you sure you want to disable TradingView webhook? This will stop receiving trading signals.')) return;
    
    try {
      await strategiesAPI.disableTradingView(strategy.id);
      console.log('✅ TradingView webhook disabled');
      onUpdate();
    } catch (error) {
      console.error('Error disabling TradingView:', error);
      alert('Failed to disable TradingView webhook');
    }
  };

  const handleCopyWebhookUrl = () => {
    if (strategy.webhookUrl) {
      copyToClipboard(strategy.webhookUrl, () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const openTrades = trades.filter(t => t.status === 'new' || t.status === 'partially_filled' || t.status === 'accepted');
  const closedTrades = trades.filter(t => t.status === 'filled' || t.status === 'canceled' || t.status === 'rejected');
  
  const filteredTrades = activeTab === 'open' ? openTrades : activeTab === 'closed' ? closedTrades : trades;

  // Calculate performance
  const totalPnL = closedTrades.reduce((sum, trade) => {
    if (trade.side === 'sell' && trade.filledAvgPrice) {
      // Simplified P&L calculation
      return sum + ((trade.filledAvgPrice - (trade.price || 0)) * trade.filledQty);
    }
    return sum;
  }, 0);

  const winningTrades = closedTrades.filter(t => t.side === 'sell' && t.filledAvgPrice && t.price && t.filledAvgPrice > t.price).length;
  const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* TradingView Webhook Section */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-slate-100 mb-1">TradingView Integration</h3>
            <p className="text-xs text-slate-400">Receive automated signals from TradingView</p>
          </div>
          {strategy.tradingViewEnabled ? (
            <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"></div>
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-slate-800 text-slate-400">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-600"></div>
              Disconnected
            </span>
          )}
        </div>

        {strategy.tradingViewEnabled && strategy.webhookUrl ? (
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-xs text-slate-400">Webhook URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={strategy.webhookUrl}
                  readOnly
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-xs font-mono text-slate-300 outline-none"
                />
                <button
                  onClick={handleCopyWebhookUrl}
                  className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Use this URL in your TradingView strategy alert webhook
              </p>
            </div>

            <div className="rounded-lg bg-blue-500/10 p-3 text-xs text-blue-300">
              <p className="mb-2">📋 <span className="text-slate-200">TradingView Setup Instructions:</span></p>
              <ol className="ml-4 list-decimal space-y-1 text-slate-300">
                <li>Open your TradingView strategy</li>
                <li>Create a new alert</li>
                <li>In Alert Actions, enable "Webhook URL"</li>
                <li>Paste the URL above</li>
                <li>Set your alert message (JSON format recommended)</li>
              </ol>
            </div>

            <div className="rounded-lg bg-slate-800/50 p-3 text-xs">
              <p className="mb-2 text-slate-300">Example Alert Message:</p>
              <pre className="overflow-x-auto rounded bg-slate-900 p-2 text-emerald-400">
{`{
  "action": "buy",
  "symbol": "AAPL",
  "quantity": 10,
  "type": "market"
}`}
              </pre>
            </div>

            <button
              onClick={handleDisableTradingView}
              className="w-full rounded-lg border border-rose-500/50 bg-rose-500/10 py-2 text-sm text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              Disable Webhook
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-4 text-sm text-slate-400">
              Connect TradingView to automatically execute trades when your strategy sends webhook signals.
            </p>
            <button
              onClick={handleEnableTradingView}
              className={`w-full rounded-lg bg-blue-500 py-3 text-white transition-colors hover:bg-blue-600 ${
                enabling ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              disabled={enabling}
            >
              {enabling ? 'Enabling...' : 'Enable TradingView Webhook'}
            </button>
          </div>
        )}
      </div>

      {/* Strategy Performance */}
      {strategy.tradingViewEnabled && trades.length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
          <h3 className="text-slate-100 mb-4">Performance</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Total Trades</p>
              <p className="text-lg font-mono text-slate-100">{trades.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Win Rate</p>
              <p className={`text-lg font-mono ${winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {winRate.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Open Trades</p>
              <p className="text-lg font-mono text-blue-400">{openTrades.length}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Total P/L</p>
              <p className={`text-lg font-mono ${totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${totalPnL.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Trades List */}
      {strategy.tradingViewEnabled && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-100">Strategy Trades</h3>
            <button
              onClick={loadTrades}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Refresh
            </button>
          </div>

          {/* Tabs */}
          <div className="mb-4 flex gap-2 border-b border-slate-700">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'all'
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              All ({trades.length})
            </button>
            <button
              onClick={() => setActiveTab('open')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'open'
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Open ({openTrades.length})
            </button>
            <button
              onClick={() => setActiveTab('closed')}
              className={`px-4 py-2 text-sm transition-colors ${
                activeTab === 'closed'
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              Closed ({closedTrades.length})
            </button>
          </div>

          {loadingTrades ? (
            <div className="text-center py-8 text-slate-400">Loading trades...</div>
          ) : filteredTrades.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No {activeTab !== 'all' ? activeTab : ''} trades yet
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredTrades.map((trade) => (
                <div
                  key={trade.id}
                  className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white">{trade.symbol}</span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            trade.side === 'buy'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {trade.side.toUpperCase()}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            trade.status === 'filled'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : trade.status === 'canceled' || trade.status === 'rejected'
                              ? 'bg-rose-500/10 text-rose-400'
                              : 'bg-blue-500/10 text-blue-400'
                          }`}
                        >
                          {trade.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        <Clock className="inline h-3 w-3 mr-1" />
                        {new Date(trade.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-slate-100">{trade.quantity} shares</p>
                      {trade.filledAvgPrice && (
                        <p className="text-xs text-slate-400">@${trade.filledAvgPrice.toFixed(2)}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

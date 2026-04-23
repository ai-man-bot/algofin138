import { useState, useEffect } from 'react';
import { Plus, Copy, Trash2, RefreshCw, CheckCircle2, XCircle, Clock } from './CustomIcons';
import { webhooksAPI, testWebhook, strategiesAPI } from '../utils/api';
import { LinkIcon } from '@heroicons/react/24/outline';

// Fallback copy function that works without clipboard permissions
const copyToClipboard = (text: string) => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    alert('Webhook URL copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy:', err);
    alert('Failed to copy. Please copy manually: ' + text);
  }
  document.body.removeChild(textarea);
};

export function WebhooksPage() {
  const [showModal, setShowModal] = useState(false);
  const [webhookName, setWebhookName] = useState('');
  const [selectedStrategyId, setSelectedStrategyId] = useState('');
  const [strategies, setStrategies] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testWebhookUrl, setTestWebhookUrl] = useState('');
  const [testPayload, setTestPayload] = useState('{\"action\":\"buy\",\"symbol\":\"AAPL\",\"quantity\":100}');
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    loadWebhooks();
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      const strategiesData = await strategiesAPI.getAll();
      setStrategies(strategiesData);
      // Set first strategy as default if available
      if (strategiesData.length > 0 && !selectedStrategyId) {
        setSelectedStrategyId(strategiesData[0].id);
      }
    } catch (error) {
      console.error('Error loading strategies:', error);
    }
  };

  const loadWebhooks = async () => {
    try {
      setLoading(true);
      const webhooksData = await webhooksAPI.getAll();
      setWebhooks(webhooksData);
      
      // Load ALL events (not tied to specific webhook ID)
      // The backend returns all events for the user
      const eventsData = await webhooksAPI.getEvents('all');
      
      // Sort events by timestamp (newest first)
      const sortedEvents = eventsData.sort((a: any, b: any) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
      
      setRecentEvents(sortedEvents);
    } catch (error) {
      console.error('Error loading webhooks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate that a strategy is selected
    if (!selectedStrategyId) {
      alert('Please select a strategy for this webhook.');
      return;
    }
    
    try {
      await webhooksAPI.create({
        name: webhookName,
        strategyId: selectedStrategyId,
        status: 'active',
      });
      setShowModal(false);
      setWebhookName('');
      setSelectedStrategyId('');
      await loadWebhooks();
    } catch (error) {
      console.error('Error creating webhook:', error);
      alert('Failed to create webhook. Please try again.');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;
    
    try {
      await webhooksAPI.delete(id);
      await loadWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      alert('Failed to delete webhook. Please try again.');
    }
  };

  const handleTestWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestResult(null);
    
    try {
      // Parse the JSON payload first to validate it
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(testPayload);
      } catch (parseError) {
        setTestResult({ 
          error: 'Invalid JSON payload', 
          details: String(parseError) 
        });
        return;
      }
      
      // Send request through the backend proxy to avoid CORS issues
      const result = await testWebhook(testWebhookUrl, parsedPayload);
      
      setTestResult(result);
      
      // Refresh events after successful test
      if (result.ok) {
        setTimeout(() => loadWebhooks(), 1000);
      }
    } catch (error) {
      console.error('Error testing webhook:', error);
      setTestResult({ 
        error: 'Failed to send webhook request',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading webhooks...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="mb-2 text-slate-100">Webhooks</h2>
          <p className="text-slate-400">Receive signals from external platforms</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 transition-colors hover:bg-blue-600"
        >
          <Plus className="h-5 w-5" />
          Create Webhook
        </button>
      </div>

      {/* Webhook Cards */}
      <div className="mb-8 space-y-4">
        {webhooks.length === 0 ? (
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-12 text-center backdrop-blur-sm">
            <div className="mb-4 flex justify-center">
              <div className="rounded-full bg-slate-800 p-4">
                <Plus className="h-8 w-8 text-slate-400" />
              </div>
            </div>
            <h3 className="mb-2 text-slate-100">No webhooks yet</h3>
            <p className="mb-6 text-slate-400">Create your first webhook to start receiving signals</p>
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg bg-blue-500 px-6 py-3 transition-colors hover:bg-blue-600"
            >
              Create Webhook
            </button>
          </div>
        ) : (
          webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm transition-all hover:border-slate-600/50"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="text-slate-100">{webhook.name}</h3>
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                        webhook.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${
                          webhook.status === 'active' ? 'bg-emerald-400' : 'bg-slate-600'
                        }`}
                      ></div>
                      {webhook.status.charAt(0).toUpperCase() + webhook.status.slice(1)}
                    </span>
                  </div>
                  {webhook.strategy && (
                    <p className="mb-4 text-sm text-slate-400">
                      Strategy: <span className="text-blue-400">{webhook.strategy}</span>
                    </p>
                  )}

                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-6">
                    <div className="mb-4 flex items-start gap-3">
                      <LinkIcon className="mt-1 h-5 w-5 flex-shrink-0 text-blue-400" />
                      <div className="flex-1">
                        <h3 className="mb-1 text-slate-100">Webhook URL</h3>
                        <p className="mb-3 text-sm text-slate-400">
                          Use this URL to send trade signals from external platforms like TradingView
                        </p>
                        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                          <code className="break-all font-mono text-xs text-slate-300">
                            {webhook.url}
                          </code>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            onClick={() => {
                              copyToClipboard(webhook.url);
                            }}
                            className="rounded bg-blue-500/20 px-3 py-1 text-sm text-blue-400 transition-colors hover:bg-blue-500/30"
                          >
                            Copy URL
                          </button>
                          <button
                            onClick={() => {
                              setTestWebhookUrl(webhook.url);
                              setShowTestModal(true);
                            }}
                            className="rounded bg-emerald-500/20 px-3 py-1 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/30"
                          >
                            Test Webhook
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-4 rounded-lg bg-slate-900/50 p-4 text-xs text-slate-400">
                      <p className="mb-2 font-mono">
                        ℹ️ <strong>How it works:</strong> This webhook uses a unique token for authentication. 
                        External services like TradingView can POST directly to this URL.
                      </p>
                      <p className="font-mono">
                        ✅ The webhook is ready to receive POST requests with JSON payloads containing trade signals.
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Total Triggers</p>
                      <p className="font-mono text-slate-100">{webhook.triggers || 0}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Success Rate</p>
                      <p className="font-mono text-emerald-400">{webhook.successRate || 100}%</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Last Triggered</p>
                      <p className="text-sm text-slate-400">
                        {webhook.lastTriggered || 'Never'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="ml-4 flex gap-2">
                  <button
                    onClick={() => loadWebhooks()}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  >
                    <RefreshCw className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleDeleteWebhook(webhook.id)}
                    className="rounded-lg p-2 text-rose-400 transition-colors hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Events */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
        <div className="border-b border-slate-700/50 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-slate-100">Recent Events</h3>
            <p className="text-sm text-slate-400">Webhook activity log</p>
          </div>
          <button
            onClick={loadWebhooks}
            className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm transition-colors hover:bg-slate-700"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
        {recentEvents.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            No webhook events yet. Send a request to your webhook URL to see it here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50 text-left text-sm text-slate-400">
                  <th className="p-4">Webhook</th>
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">Asset</th>
                  <th className="p-4">Order Type</th>
                  <th className="p-4">Side</th>
                  <th className="p-4">Qty</th>
                  <th className="p-4">Filled Qty</th>
                  <th className="p-4">Avg. Fill Price</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Error</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event, idx) => {
                  // Extract order details from payload and alpaca response
                  const symbol = event.payload?.symbol || '-';
                  const side = event.payload?.action || '-';
                  const quantity = event.payload?.quantity || '-';
                  const orderType = event.alpacaOrder?.type || 'market';
                  const filledQty = event.alpacaOrder?.filled_qty || event.alpacaOrder?.qty || quantity;
                  const avgFillPrice = event.alpacaOrder?.filled_avg_price || event.payload?.price || '-';
                  const orderStatus = event.alpacaOrder?.status || (event.status === 'success' ? 'filled' : 'failed');
                  
                  return (
                    <tr
                      key={idx}
                      className="border-b border-slate-700/30 transition-colors hover:bg-slate-800/30"
                    >
                      <td className="p-4 text-sm text-slate-100">{event.webhook}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-400">
                          <Clock className="h-4 w-4" />
                          {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown'}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-sm text-blue-400 underline cursor-pointer">
                          {symbol}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="text-sm text-slate-300 capitalize">
                          {orderType}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-sm capitalize ${
                          side === 'buy' ? 'text-emerald-400' : side === 'sell' ? 'text-rose-400' : 'text-slate-300'
                        }`}>
                          {side}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-sm text-slate-300">
                          {typeof quantity === 'number' ? quantity.toFixed(2) : quantity}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-sm text-slate-300">
                          {typeof filledQty === 'number' ? filledQty.toFixed(2) : filledQty}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-sm text-slate-300">
                          {typeof avgFillPrice === 'number' ? avgFillPrice.toFixed(5) : avgFillPrice}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                          orderStatus === 'filled' ? 'bg-emerald-500/10 text-emerald-400' :
                          orderStatus === 'partially_filled' ? 'bg-yellow-500/10 text-yellow-400' :
                          orderStatus === 'pending_new' || orderStatus === 'new' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-rose-500/10 text-rose-400'
                        }`}>
                          {orderStatus}
                        </span>
                      </td>
                      <td className="p-4">
                        {event.error ? (
                          <span className="text-sm text-rose-400">{event.error}</span>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Webhook Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl">
            <h3 className="mb-2 text-slate-100">Create New Webhook</h3>
            <p className="mb-6 text-sm text-slate-400">
              Generate a unique webhook URL for receiving signals
            </p>

            <form onSubmit={handleCreateWebhook} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Webhook Name</label>
                <input
                  type="text"
                  value={webhookName}
                  onChange={(e) => setWebhookName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  placeholder="My TradingView Strategy"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Strategy</label>
                {strategies.length === 0 ? (
                  <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-300">
                    <p className="mb-2">⚠️ No strategies found</p>
                    <p className="text-xs">Please create a strategy first before creating a webhook. Webhooks need to be linked to a strategy for trade tracking.</p>
                  </div>
                ) : (
                  <select
                    value={selectedStrategyId}
                    onChange={(e) => setSelectedStrategyId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-slate-300 outline-none transition-colors focus:border-blue-500"
                    required
                  >
                    <option value="">Select a strategy...</option>
                    {strategies.map(strategy => (
                      <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-300">
                <p className="flex items-start gap-2">
                  <span className="mt-0.5">ℹ️</span>
                  <span>
                    After creation, you&apos;ll receive a unique URL to use in your external platform.
                  </span>
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={strategies.length === 0}
                  className="flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Test Webhook Modal */}
      {showTestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl">
            <h3 className="mb-2 text-slate-100">Test Webhook</h3>
            <p className="mb-6 text-sm text-slate-400">
              Send a test payload to your webhook URL
            </p>

            <form onSubmit={handleTestWebhook} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Webhook URL</label>
                <input
                  type="text"
                  value={testWebhookUrl}
                  onChange={(e) => setTestWebhookUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  placeholder="https://example.com/webhook"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Payload</label>
                <textarea
                  value={testPayload}
                  onChange={(e) => setTestPayload(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  placeholder='{"action":"buy","symbol":"AAPL","quantity":100}'
                  rows={4}
                  required
                />
              </div>

              <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-300">
                <p className="flex items-start gap-2">
                  <span className="mt-0.5">ℹ️</span>
                  <span>
                    Send a test payload to verify your webhook is working correctly.
                  </span>
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600"
                >
                  Test
                </button>
              </div>

              {testResult && (
                <div className={`mt-4 rounded-lg p-4 text-sm ${
                  testResult.error || testResult.execution?.error 
                    ? 'bg-rose-500/10 border border-rose-500/30' 
                    : 'bg-emerald-500/10 border border-emerald-500/30'
                }`}>
                  <p className={`font-bold mb-2 ${
                    testResult.error || testResult.execution?.error ? 'text-rose-400' : 'text-emerald-400'
                  }`}>
                    {testResult.error || testResult.execution?.error ? '❌ Test Failed' : '✅ Test Successful'}
                  </p>
                  
                  {testResult.error && (
                    <div className="mb-3 text-rose-300">
                      <div className="font-bold">Error:</div>
                      <div>{testResult.error}</div>
                      {testResult.details && <div className="text-xs mt-1 opacity-75">{testResult.details}</div>}
                    </div>
                  )}
                  
                  {testResult.execution?.error && (
                    <div className="mb-3 text-rose-300">
                      <div className="font-bold">Execution Error:</div>
                      <div>{testResult.execution.error}</div>
                      {testResult.execution.alpacaError && (
                        <div className="mt-2 text-xs">
                          <div className="font-bold">Alpaca Response:</div>
                          <pre className="mt-1 bg-slate-950/50 p-2 rounded">
                            {JSON.stringify(testResult.execution.alpacaError, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {testResult.tradeId && (
                    <div className="mb-2 text-emerald-300">
                      <div className="font-bold">Trade ID:</div>
                      <div className="font-mono text-xs">{testResult.tradeId}</div>
                    </div>
                  )}
                  
                  <details className="mt-3">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-300">Full Response</summary>
                    <pre className="mt-2 font-mono text-xs text-slate-300 bg-slate-950/50 p-3 rounded overflow-x-auto">
                      {JSON.stringify(testResult, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
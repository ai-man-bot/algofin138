import { useState, useEffect } from 'react';
import { CheckCircle2, Plus, X, Key, Lock } from './CustomIcons';
import { brokersAPI } from '../utils/api';

const availableBrokers = [
  {
    id: 'alpaca',
    name: 'Alpaca',
    logo: '🦙',
    description: 'Commission-free stock trading API',
  },
  {
    id: 'interactive',
    name: 'Interactive Brokers',
    logo: '🏦',
    description: 'Professional trading platform',
  },
  {
    id: 'tdameritrade',
    name: 'TD Ameritrade',
    logo: '📊',
    description: 'Full-service brokerage',
  },
];

export function BrokersPage() {
  const [showModal, setShowModal] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connectedBrokers, setConnectedBrokers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    loadBrokers();
  }, []);

  const loadBrokers = async () => {
    try {
      setLoading(true);
      const brokers = await brokersAPI.getAll();
      setConnectedBrokers(brokers || []);
    } catch (err) {
      console.error('Error loading brokers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = (broker: any) => {
    setSelectedBroker(broker);
    setShowModal(true);
    setError('');
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedBroker(null);
    setApiKey('');
    setApiSecret('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBroker) return;

    try {
      setConnecting(true);
      setError('');
      
      console.log('🔌 Attempting to connect broker:', selectedBroker.name);
      console.log('  API Key length:', apiKey.length);
      console.log('  API Secret length:', apiSecret.length);

      await brokersAPI.connect(
        selectedBroker.id,
        selectedBroker.name,
        apiKey,
        apiSecret
      );
      
      console.log('✅ Broker connected successfully');

      // Reload brokers
      await loadBrokers();

      closeModal();
    } catch (err: any) {
      console.error('❌ Error connecting broker:', err);
      console.error('  Error message:', err.message);
      
      // Provide more helpful error messages
      let errorMessage = err.message || 'Failed to connect broker';
      
      if (errorMessage.includes('Invalid authentication token')) {
        errorMessage = 'Your session has expired. Please log out and log in again, then try connecting your broker.';
      } else if (errorMessage.includes('Invalid Alpaca credentials')) {
        errorMessage = 'Invalid Alpaca API credentials. Please check your API Key and Secret Key.';
      }
      
      setError(errorMessage);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (brokerId: string) => {
    if (!confirm('Are you sure you want to disconnect this broker?')) return;

    try {
      await brokersAPI.disconnect(brokerId);
      await loadBrokers();
    } catch (err) {
      console.error('Error disconnecting broker:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading brokers...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h2 className="mb-2 text-slate-100">Broker Connections</h2>
        <p className="text-slate-400">Manage your trading account integrations</p>
      </div>

      {/* Connected Broker Accounts */}
      {connectedBrokers.length > 0 && (
        <>
          <div className="mb-4">
            <h3 className="text-slate-100">Connected Accounts ({connectedBrokers.length})</h3>
            <p className="text-sm text-slate-400">Your active broker connections</p>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
            {connectedBrokers.map((connectedBroker) => {
              const brokerInfo = availableBrokers.find(b => b.id === connectedBroker.brokerType);
              return (
                <div
                  key={connectedBroker.id}
                  className="rounded-xl border border-emerald-700/50 bg-emerald-900/10 p-6 backdrop-blur-sm transition-all hover:border-emerald-600/50"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-800 text-2xl">
                        {brokerInfo?.logo || '🏦'}
                      </div>
                      <div>
                        <h3 className="text-slate-100">{connectedBroker.name}</h3>
                        <p className="text-xs text-slate-500">{brokerInfo?.description || 'Trading account'}</p>
                      </div>
                    </div>
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>

                  <div className="mb-4">
                    <div className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs bg-emerald-500/10 text-emerald-400">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"></div>
                      Active
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Account ID:</span>
                      <span className="font-mono text-xs text-slate-300 truncate">
                        {connectedBroker.accountId || 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-400">Connected:</span>
                      <span className="text-slate-300">
                        {connectedBroker.connectedAt 
                          ? new Date(connectedBroker.connectedAt).toLocaleDateString() 
                          : 'Unknown'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDisconnect(connectedBroker.id)}
                      className="mt-4 w-full rounded-lg border border-rose-700 bg-rose-500/10 py-2 text-sm text-rose-400 transition-colors hover:bg-rose-500/20"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Add New Broker Section */}
      <div className="mb-4">
        <h3 className="text-slate-100">Add New Connection</h3>
        <p className="text-sm text-slate-400">Connect another trading account (supports multiple accounts per broker)</p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
        {/* Add New Broker Card */}
        <button
          onClick={() => setShowModal(true)}
          className="group rounded-xl border-2 border-dashed border-slate-700/50 bg-slate-900/20 p-6 backdrop-blur-sm transition-all hover:border-blue-500/50 hover:bg-slate-900/30"
        >
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 transition-colors group-hover:bg-blue-500/20">
              <Plus className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-slate-100">Connect Broker Account</h3>
            <p className="text-sm text-slate-400">Add another trading account</p>
          </div>
        </button>
      </div>

      {/* Connection Instructions */}
      <div className="mt-8 rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
        <h3 className="mb-4 text-slate-100">How to Connect</h3>
        <ol className="space-y-3 text-sm text-slate-400">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10 text-xs text-blue-400">
              1
            </span>
            <span>Log in to your broker&apos;s platform and navigate to API settings</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10 text-xs text-blue-400">
              2
            </span>
            <span>Generate a new API key and secret (ensure trading permissions are enabled)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10 text-xs text-blue-400">
              3
            </span>
            <span>Copy the credentials and paste them into AlgoFin.ai connection form</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/10 text-xs text-blue-400">
              4
            </span>
            <span>Verify the connection and start trading</span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-xs text-emerald-400">
              ✓
            </span>
            <span>You can connect multiple accounts from the same broker (e.g., multiple Alpaca accounts)</span>
          </li>
        </ol>
      </div>

      {/* Connection Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl">
            <button
              onClick={closeModal}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-300"
            >
              <X className="h-6 w-6" />
            </button>

            <h3 className="mb-2 text-slate-100">
              {selectedBroker ? `Connect ${selectedBroker.name}` : 'Connect Broker'}
            </h3>
            <p className="mb-6 text-sm text-slate-400">
              {selectedBroker ? 'Enter your API credentials to establish connection' : 'Select a broker and enter your API credentials'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!selectedBroker && (
                <div>
                  <label className="mb-2 block text-sm text-slate-300">
                    Select Broker
                  </label>
                  <select
                    value={selectedBroker?.id || ''}
                    onChange={(e) => {
                      const broker = availableBrokers.find(b => b.id === e.target.value);
                      setSelectedBroker(broker || null);
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 px-4 text-white outline-none transition-colors focus:border-blue-500"
                    required
                  >
                    <option value="">Choose a broker...</option>
                    {availableBrokers.map(broker => (
                      <option key={broker.id} value={broker.id}>
                        {broker.logo} {broker.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selectedBroker && (
                <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700 text-xl">
                    {selectedBroker.logo}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-300">{selectedBroker.name}</p>
                    <p className="text-xs text-slate-500">{selectedBroker.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBroker(null)}
                    className="text-slate-400 hover:text-slate-300 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  API Key
                </label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                    placeholder="PK1234567890ABCDEF"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">
                  API Secret
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="password"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 py-3 pl-10 pr-4 font-mono text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                    placeholder="••••••••••••••••"
                    required
                  />
                </div>
              </div>

              <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-300">
                <p className="flex items-start gap-2">
                  <span className="mt-0.5">ℹ️</span>
                  <span>
                    Your credentials are encrypted and stored securely. We never share or sell your data.
                  </span>
                </p>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 p-4 text-sm text-red-300">
                  <p className="flex items-start gap-2">
                    <span className="mt-0.5">⚠️</span>
                    <span>{error}</span>
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 ${
                    connecting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

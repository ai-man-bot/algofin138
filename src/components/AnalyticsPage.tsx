import { useState, useEffect } from 'react';
import { analyticsAPI, tradesAPI } from '../utils/api';
import { TrendingUp, TrendingDown, Activity, DollarSign, Target, AlertTriangle, BarChart3, RefreshCw } from './CustomIcons';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from 'recharts';

export function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);

  useEffect(() => {
    loadAnalytics();
  }, []);
  
  // Auto-sync on first load if no trades
  useEffect(() => {
    if (analytics && !hasAutoSynced && analytics.totalTrades === 0) {
      console.log('📊 Analytics: No trades found, auto-syncing...');
      setHasAutoSynced(true);
      handleSyncAll();
    }
  }, [analytics, hasAutoSynced]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      console.log('📊 Analytics: Loading portfolio analytics...');
      const data = await analyticsAPI.getPortfolio();
      console.log('📊 Analytics: Received data:', data);
      setAnalytics(data);
    } catch (error) {
      console.error('Error loading analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      await tradesAPI.syncAll();
      // Reload analytics after sync
      setTimeout(() => {
        loadAnalytics();
        setSyncing(false);
      }, 1000);
    } catch (error) {
      console.error('Error syncing trades:', error);
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading analytics...</div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">No analytics data available</div>
      </div>
    );
  }

  const COLORS = ['#10b981', '#f43f5e', '#3b82f6', '#f59e0b', '#8b5cf6'];

  return (
    <div className="min-h-screen bg-[#0f172a] p-6">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-slate-100">Portfolio Analytics</h1>
            <p className="text-sm text-slate-400 mt-1">
              Comprehensive performance metrics and insights
            </p>
          </div>
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync All Trades'}
          </button>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid gap-4 mb-6 md:grid-cols-2 lg:grid-cols-4">
          {/* Total P&L */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total P&L</p>
                <p className={`mt-2 ${analytics.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${analytics.totalPnL.toFixed(2)}
                </p>
              </div>
              <div className={`rounded-full p-3 ${analytics.totalPnL >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                <DollarSign className={`h-6 w-6 ${analytics.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
              </div>
            </div>
          </div>

          {/* Win Rate */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Win Rate</p>
                <p className="mt-2 text-slate-100">
                  {analytics.winRate.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {analytics.winningTrades}W / {analytics.losingTrades}L
                </p>
              </div>
              <div className="rounded-full bg-blue-500/10 p-3">
                <Target className="h-6 w-6 text-blue-400" />
              </div>
            </div>
          </div>

          {/* Profit Factor */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Profit Factor</p>
                <p className={`mt-2 ${analytics.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {analytics.profitFactor.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Avg Win: ${analytics.avgWin.toFixed(2)}
                </p>
              </div>
              <div className={`rounded-full p-3 ${analytics.profitFactor >= 1 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                <TrendingUp className={`h-6 w-6 ${analytics.profitFactor >= 1 ? 'text-emerald-400' : 'text-rose-400'}`} />
              </div>
            </div>
          </div>

          {/* Sharpe Ratio */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Sharpe Ratio</p>
                <p className="mt-2 text-slate-100">
                  {analytics.sharpeRatio.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Max DD: ${analytics.maxDrawdown.toFixed(2)}
                </p>
              </div>
              <div className="rounded-full bg-purple-500/10 p-3">
                <BarChart3 className="h-6 w-6 text-purple-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Additional Stats */}
        <div className="grid gap-4 mb-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <p className="text-sm text-slate-400">Total Trades</p>
            <p className="mt-2 text-slate-100">{analytics.totalTrades}</p>
            <div className="mt-3 flex gap-4 text-xs">
              <span className="text-emerald-400">{analytics.closedTrades} Closed</span>
              <span className="text-blue-400">{analytics.openTrades} Open</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <p className="text-sm text-slate-400">Average Win</p>
            <p className="mt-2 text-emerald-400">${analytics.avgWin.toFixed(2)}</p>
          </div>

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <p className="text-sm text-slate-400">Average Loss</p>
            <p className="mt-2 text-rose-400">${analytics.avgLoss.toFixed(2)}</p>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 mb-6 lg:grid-cols-2">
          {/* Daily P&L Chart */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <h2 className="mb-4 text-slate-100">Daily P&L (Last 30 Days)</h2>
            {analytics.dailyPnL && analytics.dailyPnL.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={analytics.dailyPnL}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getMonth() + 1}/${date.getDate()}`;
                    }}
                  />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#1e293b', 
                      border: '1px solid #334155',
                      borderRadius: '8px'
                    }}
                    formatter={(value: any) => [`$${parseFloat(value).toFixed(2)}`, 'P&L']}
                  />
                  <Bar 
                    dataKey="pnl" 
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-slate-500">
                No daily P&L data available
              </div>
            )}
          </div>

          {/* Strategy Performance */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
            <h2 className="mb-4 text-slate-100">Strategy Performance</h2>
            {analytics.strategyMetrics && analytics.strategyMetrics.length > 0 ? (
              <div className="space-y-4">
                {analytics.strategyMetrics
                  .sort((a: any, b: any) => b.pnl - a.pnl)
                  .slice(0, 5)
                  .map((strategy: any, index: number) => (
                    <div key={strategy.id} className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <div 
                            className="h-3 w-3 rounded-full" 
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                          />
                          <p className="text-sm text-slate-100">{strategy.name}</p>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 ml-5">
                          {strategy.totalTrades} trades • {strategy.winRate.toFixed(1)}% win rate
                        </p>
                      </div>
                      <div className={`text-right ${strategy.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <p>{strategy.pnl >= 0 ? '+' : ''}${strategy.pnl.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-slate-500">
                No strategy data available
              </div>
            )}
          </div>
        </div>

        {/* Performance Summary */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6">
          <h2 className="mb-4 text-slate-100">Performance Summary</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
              <p className="text-xs text-slate-400 mb-1">Total Trades</p>
              <p className="text-slate-100">{analytics.totalTrades}</p>
            </div>
            <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
              <p className="text-xs text-slate-400 mb-1">Closed Positions</p>
              <p className="text-slate-100">{analytics.closedTrades}</p>
            </div>
            <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
              <p className="text-xs text-slate-400 mb-1">Winning Trades</p>
              <p className="text-emerald-400">{analytics.winningTrades}</p>
            </div>
            <div className="rounded-lg border border-slate-700/30 bg-slate-900/30 p-4">
              <p className="text-xs text-slate-400 mb-1">Losing Trades</p>
              <p className="text-rose-400">{analytics.losingTrades}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
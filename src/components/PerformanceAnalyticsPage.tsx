import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, BarChart3, Activity, AlertTriangle, CheckCircle, XCircle, ArrowUpRight, ArrowDownRight, Calendar, DollarSign, Target, Percent, RefreshCw } from './CustomIcons';
import { strategiesAPI, tradesAPI } from '../utils/api';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, Area, ScatterChart, Scatter, Cell } from 'recharts';
import {
  calculateBacktestMetrics,
  calculateDivergenceAlerts as buildDivergenceAlerts,
  calculateLiveMetricsFromTrades,
  type DivergenceAlert,
  type PerformanceMetrics,
  type StrategyBacktestData,
} from '../utils/tradeAnalytics';

interface Strategy {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'inactive';
  backtestData?: {
    // Performance tab - matching actual TradingView data structure
    initialCapital: number;
    netProfit: number;
    netProfitPercent: number;
    maxEquityDrawdown: number;
    maxEquityDrawdownPercent: number;
    
    // Trades Analysis tab
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    percentProfitable: number;
    avgPnL: number;
    avgWinningTrade: number;
    avgLosingTrade: number;
    ratioAvgWinLoss: number;
    
    // Additional metrics
    sharpeRatio: number;
    profitFactor: number;
    
    // Properties (stored as raw data)
    properties?: Record<string, any>;
    
    // File metadata
    fileName?: string;
    uploadedAt?: string;
  };
}

interface Trade {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  status: string;
  submittedAt: string;
  filledAt?: string;
  closedAt?: string;
}

export function PerformanceAnalyticsPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL'>('1M');
  
  const [backtestMetrics, setBacktestMetrics] = useState<PerformanceMetrics | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<PerformanceMetrics | null>(null);
  const [divergenceAlerts, setDivergenceAlerts] = useState<DivergenceAlert[]>([]);
  const [dailyReturnsData, setDailyReturnsData] = useState<any[]>([]);
  const [hasAutoSynced, setHasAutoSynced] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedStrategyId) {
      loadStrategyAnalytics();
    }
  }, [selectedStrategyId, timeframe]);
  
  // Auto-sync on first load if no live metrics
  useEffect(() => {
    if (selectedStrategyId && !hasAutoSynced && !liveMetrics) {
      console.log('📊 Performance: No live trades found, auto-syncing...');
      setHasAutoSynced(true);
      handleSyncAll();
    }
  }, [selectedStrategyId, liveMetrics, hasAutoSynced]);

  const handleSyncAll = async () => {
    try {
      console.log('📊 Performance: Syncing all trades...');
      await tradesAPI.syncAll();
      // Reload after sync
      setTimeout(() => {
        loadStrategyAnalytics();
      }, 1000);
    } catch (error) {
      console.error('Error syncing trades:', error);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const strategiesData = await strategiesAPI.getAll();
      setStrategies(strategiesData);
      
      // Auto-select first strategy with backtest data
      const strategyWithBacktest = strategiesData.find((s: Strategy) => s.backtestData);
      if (strategyWithBacktest) {
        setSelectedStrategyId(strategyWithBacktest.id);
      } else if (strategiesData.length > 0) {
        setSelectedStrategyId(strategiesData[0].id);
      }
    } catch (error) {
      console.error('Error loading strategies:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStrategyAnalytics = async () => {
    if (!selectedStrategyId) return;

    try {
      setLoading(true);
      
      // Load trades for the selected strategy
      const allTrades = await tradesAPI.getAll();
      const strategyTrades = allTrades.filter((t: Trade) => t.strategyId === selectedStrategyId);
      setTrades(strategyTrades);
      
      console.log(`📊 Performance: Found ${strategyTrades.length} trades for strategy ${selectedStrategyId}`);
      console.log('📊 Performance: Sample trades:', strategyTrades.slice(0, 3));

      // Get selected strategy
      const strategy = strategies.find(s => s.id === selectedStrategyId);
      
      // Calculate backtest metrics from stored data
      if (strategy?.backtestData) {
        const bd = strategy.backtestData as StrategyBacktestData;
        setBacktestMetrics(calculateBacktestMetrics(bd));
        console.log('📊 Performance: Loaded backtest metrics:', {
          totalPnL: bd.netProfit,
          totalPnLPercent: bd.netProfitPercent,
          winRate: bd.percentProfitable,
          profitFactor: bd.profitFactor,
          maxDrawdown: Math.abs(bd.maxEquityDrawdown),
        });
      } else {
        setBacktestMetrics(null);
        console.log('📊 Performance: No backtest data found for strategy');
      }

      // Calculate live metrics from trades - use 'filled' status and pnl presence to identify closed trades
      const closedTrades = strategyTrades.filter((t: Trade) => 
        t.status === 'filled' && t.pnl !== undefined && t.pnl !== null
      );
      
      console.log(`📊 Performance: Found ${closedTrades.length} closed trades (filled with P&L)`);
      
      // Debug: Show why trades might be filtered out
      if (strategyTrades.length > 0 && closedTrades.length === 0) {
        console.log('📊 Performance: DEBUG - Why no closed trades found:');
        strategyTrades.slice(0, 5).forEach((t: Trade, idx: number) => {
          console.log(`  Trade ${idx + 1}:`, {
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            status: t.status,
            hasPnL: t.pnl !== undefined && t.pnl !== null,
            pnl: t.pnl,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
          });
        });
      }
      
      if (closedTrades.length > 0) {
        const computedLiveMetrics = calculateLiveMetricsFromTrades(
          closedTrades,
          strategy?.backtestData?.initialCapital || 100000,
        );
        setLiveMetrics(computedLiveMetrics);
        generateDailyReturnsData(closedTrades);
        setDivergenceAlerts(
          strategy?.backtestData && computedLiveMetrics
            ? buildDivergenceAlerts(strategy.backtestData as StrategyBacktestData, computedLiveMetrics)
            : [],
        );
      } else {
        setLiveMetrics(null);
        setDailyReturnsData([]);
        setDivergenceAlerts([]);
      }

    } catch (error) {
      console.error('Error loading strategy analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateDailyReturnsData = (closedTrades: Trade[]) => {
    const dailyData: { [key: string]: number } = {};

    closedTrades.forEach((trade) => {
      // Use closedAt, filledAt, or submittedAt (whichever is available)
      const dateString = trade.closedAt || trade.filledAt || trade.submittedAt;
      
      if (!dateString) {
        console.warn('Trade missing date:', trade.id);
        return;
      }
      
      try {
        const date = new Date(dateString);
        
        // Validate the date is valid
        if (isNaN(date.getTime())) {
          console.warn('Invalid date for trade:', trade.id, dateString);
          return;
        }
        
        const dateKey = date.toISOString().split('T')[0];
        
        if (!dailyData[dateKey]) {
          dailyData[dateKey] = 0;
        }
        
        dailyData[dateKey] += (trade.pnl || 0);
      } catch (error) {
        console.warn('Error parsing date for trade:', trade.id, error);
      }
    });

    const data = Object.entries(dailyData)
      .map(([date, value]) => ({
        date,
        value: Math.round(value),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)); // Sort by date ascending

    setDailyReturnsData(data);
  };

  const selectedStrategy = strategies.find(s => s.id === selectedStrategyId);

  const MetricCard = ({ 
    title, 
    backtestValue, 
    liveValue, 
    format = 'number',
    suffix = '',
    prefix = '',
  }: { 
    title: string; 
    backtestValue?: number; 
    liveValue?: number; 
    format?: 'number' | 'currency' | 'percent';
    suffix?: string;
    prefix?: string;
  }) => {
    const formatValue = (value: number | undefined) => {
      if (value === undefined) return 'N/A';
      
      if (format === 'currency') {
        return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else if (format === 'percent') {
        return `${value.toFixed(2)}%`;
      } else {
        return value.toFixed(2);
      }
    };

    const divergence = backtestValue !== undefined && liveValue !== undefined 
      ? ((liveValue - backtestValue) / Math.abs(backtestValue)) * 100 
      : 0;
    
    const isPositiveDivergence = divergence > 0;
    const hasSignificantDivergence = Math.abs(divergence) > 5;
    
    // Determine live value color based on positive/negative
    const liveColor = liveValue === undefined 
      ? 'text-slate-400' 
      : liveValue >= 0 
        ? 'text-emerald-400' 
        : 'text-rose-400';

    return (
      <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
        <div className="text-slate-400 text-sm mb-4">{title}</div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-blue-400 text-xs">Backtest</span>
            <span className="text-blue-400 font-mono">
              {prefix}{formatValue(backtestValue)}{suffix}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className={`text-xs ${liveColor}`}>Live</span>
            <span className={`font-mono ${liveColor}`}>
              {prefix}{formatValue(liveValue)}{suffix}
            </span>
          </div>
          
          {hasSignificantDivergence && backtestValue !== undefined && liveValue !== undefined && (
            <div className={`flex items-center justify-between pt-2 border-t border-slate-700/50 ${
              isPositiveDivergence ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              <span className="text-xs">Divergence</span>
              <div className="flex items-center gap-1">
                {isPositiveDivergence ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                <span className="font-mono text-xs">{Math.abs(divergence).toFixed(1)}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-blue-400" />
            <h1 className="text-2xl">Performance Analytics</h1>
          </div>
          
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Strategy Selector & Timeframe */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm text-slate-400 mb-2">Strategy</label>
            <select
              value={selectedStrategyId || ''}
              onChange={(e) => setSelectedStrategyId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {strategies.map((strategy) => (
                <option key={strategy.id} value={strategy.id}>
                  {strategy.name} {strategy.backtestData ? '(Backtest Available)' : ''}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm text-slate-400 mb-2">Timeframe</label>
            <div className="flex gap-2">
              {(['1W', '1M', '3M', '6M', '1Y', 'ALL'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    timeframe === tf
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-slate-400">Loading analytics...</div>
          </div>
        ) : !selectedStrategy ? (
          <div className="bg-slate-800/50 rounded-lg p-8 text-center">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No strategies found. Create a strategy to view analytics.</p>
          </div>
        ) : !selectedStrategy.backtestData && !liveMetrics ? (
          <div className="bg-slate-800/50 rounded-lg p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
            <p className="text-slate-400 mb-2">No backtest data or live trades available for this strategy.</p>
            <p className="text-sm text-slate-500">Upload backtest results or execute trades to view analytics.</p>
          </div>
        ) : (
          <>
            {/* Divergence Alerts */}
            {divergenceAlerts.length > 0 && (
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  <h2 className="text-lg">Performance Divergence Alerts</h2>
                </div>
                
                <div className="space-y-3">
                  {divergenceAlerts.map((alert, index) => (
                    <div
                      key={index}
                      className={`p-4 rounded-lg border ${
                        alert.severity === 'high'
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : alert.severity === 'medium'
                          ? 'bg-amber-500/10 border-amber-500/30'
                          : 'bg-blue-500/10 border-blue-500/30'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            alert.severity === 'high'
                              ? 'bg-rose-500'
                              : alert.severity === 'medium'
                              ? 'bg-amber-500'
                              : 'bg-blue-500'
                          }`} />
                          <span className="font-medium">{alert.metric}</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          alert.severity === 'high'
                            ? 'bg-rose-500/20 text-rose-400'
                            : alert.severity === 'medium'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {alert.severity.toUpperCase()}
                        </span>
                      </div>
                      
                      <p className="text-sm text-slate-300 mb-3">{alert.description}</p>
                      
                      <div className="flex items-center gap-6 text-xs">
                        <div>
                          <span className="text-slate-500">Backtest: </span>
                          <span className="text-blue-400 font-mono">{alert.backtest.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Live: </span>
                          <span className="text-emerald-400 font-mono">{alert.live.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Diff: </span>
                          <span className="font-mono">{alert.divergence.toFixed(2)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key Metrics Comparison */}
            <div>
              <h2 className="text-lg mb-4">Key Performance Metrics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                  title="Total P&L"
                  backtestValue={backtestMetrics?.totalPnL}
                  liveValue={liveMetrics?.totalPnL}
                  format="currency"
                />
                <MetricCard
                  title="Return %"
                  backtestValue={backtestMetrics?.totalPnLPercent}
                  liveValue={liveMetrics?.totalPnLPercent}
                  format="percent"
                />
                <MetricCard
                  title="Win Rate"
                  backtestValue={backtestMetrics?.winRate}
                  liveValue={liveMetrics?.winRate}
                  format="percent"
                />
                <MetricCard
                  title="Profit Factor"
                  backtestValue={backtestMetrics?.profitFactor}
                  liveValue={liveMetrics?.profitFactor}
                />
                <MetricCard
                  title="Max Drawdown"
                  backtestValue={backtestMetrics?.maxDrawdown}
                  liveValue={liveMetrics?.maxDrawdown}
                  format="currency"
                />
                <MetricCard
                  title="Max DD %"
                  backtestValue={backtestMetrics?.maxDrawdownPercent}
                  liveValue={liveMetrics?.maxDrawdownPercent}
                  format="percent"
                />
                <MetricCard
                  title="Avg Win"
                  backtestValue={backtestMetrics?.avgWin}
                  liveValue={liveMetrics?.avgWin}
                  format="currency"
                />
                <MetricCard
                  title="Avg Loss"
                  backtestValue={backtestMetrics?.avgLoss}
                  liveValue={liveMetrics?.avgLoss}
                  format="currency"
                />
              </div>
            </div>

            {/* Daily Returns Chart */}
            {dailyReturnsData.length > 0 && (
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                <h2 className="text-lg mb-4">Daily Returns</h2>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={dailyReturnsData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#94a3b8"
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      stroke="#94a3b8"
                      label={{ value: 'P&L ($)', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #475569',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, 'P&L']}
                    />
                    <Bar dataKey="value" name="Daily P&L">
                      {dailyReturnsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.value >= 0 ? '#10b981' : '#f43f5e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Statistical Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                <h2 className="text-lg mb-4">Trade Statistics</h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Total Trades</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{backtestMetrics?.totalTrades || 0}</span>
                      <span className="text-emerald-400 font-mono">{liveMetrics?.totalTrades || 0}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Winning Trades</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{backtestMetrics?.winningTrades || 0}</span>
                      <span className="text-emerald-400 font-mono">{liveMetrics?.winningTrades || 0}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Losing Trades</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{backtestMetrics?.losingTrades || 0}</span>
                      <span className="text-emerald-400 font-mono">{liveMetrics?.losingTrades || 0}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Expectancy</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">
                        ${(backtestMetrics?.expectancy || 0).toFixed(2)}
                      </span>
                      <span className="text-emerald-400 font-mono">
                        ${(liveMetrics?.expectancy || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-700/50">
                  <div className="flex gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-400 rounded" />
                      <span className="text-slate-400">Backtest</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-emerald-400 rounded" />
                      <span className="text-slate-400">Live</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                <h2 className="text-lg mb-4">Risk-Adjusted Metrics</h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Sharpe Ratio</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{(backtestMetrics?.sharpeRatio || 0).toFixed(2)}</span>
                      <span className="text-emerald-400 font-mono">{(liveMetrics?.sharpeRatio || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Sortino Ratio</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{(backtestMetrics?.sortinoRatio || 0).toFixed(2)}</span>
                      <span className="text-emerald-400 font-mono">{(liveMetrics?.sortinoRatio || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center pb-2 border-b border-slate-700/50">
                    <span className="text-slate-400">Calmar Ratio</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{(backtestMetrics?.calmarRatio || 0).toFixed(2)}</span>
                      <span className="text-emerald-400 font-mono">{(liveMetrics?.calmarRatio || 0).toFixed(2)}</span>
                    </div>
                  </div>
                  
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Profit Factor</span>
                    <div className="flex gap-4">
                      <span className="text-blue-400 font-mono">{(backtestMetrics?.profitFactor || 0).toFixed(2)}</span>
                      <span className="text-emerald-400 font-mono">{(liveMetrics?.profitFactor || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-700/50 text-xs text-slate-500">
                  <p>Higher ratios indicate better risk-adjusted returns.</p>
                  <p className="mt-1">Note: Advanced metrics calculated when sufficient data available.</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

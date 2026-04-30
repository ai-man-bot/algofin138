import { useState, useEffect } from 'react';
import { Play, Pause, Settings, TrendingUp, BarChart3, Clock, DollarSign, AlertTriangle, X, Trash2, Copy, ExternalLink, Activity, RefreshCw, Search, Upload, FileSpreadsheet, ChevronDown, ChevronUp } from './CustomIcons';
import { strategiesAPI, alpacaAPI, getAccessToken } from '../utils/api';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { buildFunctionUrl } from '../utils/supabaseUrls';
import { calculateLiveMetricsFromTrades } from '../utils/tradeAnalytics';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import { parseBacktestFile, type BacktestData } from '../utils/backtestParser';
import exampleImage from 'figma:asset/ce6861f4204477d38a1a3de896065fd4f42195d7.png';

// Sort Icons
const ChevronUpIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ChevronsUpDownIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

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

// Utility functions for date/time formatting
const formatTime = (timestamp: string) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (timestamp: string) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeToFixed = (value: any, digits = 2) => safeNumber(value).toFixed(digits);

const getTradePnl = (trade: any) =>
  safeNumber(trade?.pnl ?? trade?.profitLoss ?? trade?.realized_pnl ?? trade?.realizedPnl ?? 0);

const getTradeSubmittedAt = (trade: any) =>
  trade?.submittedAt || trade?.submitted_at || trade?.created_at || trade?.filled_at || new Date().toISOString();

const calculateHoldingTime = (entryTime: string, exitTime?: string) => {
  const start = new Date(entryTime).getTime();
  const end = exitTime ? new Date(exitTime).getTime() : Date.now();
  const diffMs = end - start;
  
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

interface Strategy {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'inactive';
  strategyType: 'manual' | 'tradingview';
  entrySignal?: string;
  exitSignal?: string;
  positionSize?: number;
  maxPositions?: number;
  riskPerTrade?: string;
  maxDailyLoss?: number;
  tradingHoursStart?: string;
  tradingHoursEnd?: string;
  symbols?: string;
  webhookUrl?: string;
  webhookToken?: string;
  createdAt?: string;
  updatedAt?: string;
  // Backtest data - matching TradingView Strategy Tester export
  backtestData?: {
    // Performance tab
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
  type: string;
  status: string;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  source: string;
  submittedAt: string;
  filledAt?: string;
  closedAt?: string;
  broker: string;
  matchedSellId?: string;
  error?: string;
}

interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturn: number;
  finalEquity: number;
  initialCapital: number;
  netProfit: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  equityCurve: any[];
  trades: any[];
}

export function StrategyPage({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [saving, setSaving] = useState(false);
  
  // Backtest state
  const [showBacktestModal, setShowBacktestModal] = useState(false);
  const [showBacktestResults, setShowBacktestResults] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null);
  const [backtestConfig, setBacktestConfig] = useState({
    startDate: '2024-01-01',
    endDate: '2024-12-01',
    initialCapital: 100000,
  });
  
  // Strategy trades state
  const [strategyTrades, setStrategyTrades] = useState<Trade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [showTradesPanel, setShowTradesPanel] = useState(false);
  const [tradesFilter, setTradesFilter] = useState<'open' | 'closed' | 'pending' | 'performance'>('open');
  const [tradesSortConfig, setTradesSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'entryTime', direction: 'desc' });
  const [tradesCurrentPage, setTradesCurrentPage] = useState(1);
  const tradesPerPage = 20;
  const closedStrategyTrades = strategyTrades.filter(
  (trade: any) =>
    trade.status === 'closed' ||
    trade.status === 'filled' ||
    trade.status === 'completed'
);

const totalPnL = closedStrategyTrades.reduce(
  (sum: number, trade: any) => sum + Number(trade.pnl ?? trade.profitLoss ?? trade.realized_pnl ?? 0),
  0
);

const winningTrades = closedStrategyTrades.filter(
  (trade: any) => Number(trade.pnl ?? trade.profitLoss ?? trade.realized_pnl ?? 0) > 0
);

const losingTrades = closedStrategyTrades.filter(
  (trade: any) => Number(trade.pnl ?? trade.profitLoss ?? trade.realized_pnl ?? 0) < 0
);

const grossProfit = winningTrades.reduce(
  (sum: number, trade: any) => sum + Number(trade.pnl ?? trade.profitLoss ?? trade.realized_pnl ?? 0),
  0
);

const grossLoss = Math.abs(
  losingTrades.reduce(
    (sum: number, trade: any) => sum + Number(trade.pnl ?? trade.profitLoss ?? trade.realized_pnl ?? 0),
    0
  )
);

const livePerformanceMetrics = {
  totalPnL,
  totalPnLPercent:
    selectedStrategy?.backtestData?.initialCapital
      ? (totalPnL / selectedStrategy.backtestData.initialCapital) * 100
      : 0,
  winRate:
    closedStrategyTrades.length > 0
      ? (winningTrades.length / closedStrategyTrades.length) * 100
      : 0,
  profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
  maxDrawdownPercent: 0,
  expectancy:
    closedStrategyTrades.length > 0
      ? totalPnL / closedStrategyTrades.length
      : 0,
  totalTrades: closedStrategyTrades.length,
};
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    status: 'inactive' as 'active' | 'paused' | 'inactive',
    strategyType: 'tradingview' as 'manual' | 'tradingview',
    entrySignal: 'RSI Oversold',
    exitSignal: 'Take Profit 3%',
    positionSize: 5000,
    maxPositions: 5,
    riskPerTrade: '2%',
    tradingHoursStart: '09:30',
    tradingHoursEnd: '16:00',
    symbols: 'AAPL, TSLA, NVDA, MSFT, GOOGL',
  });
  
  // Backtest upload state
  const [backtestFile, setBacktestFile] = useState<File | null>(null);
  const [backtestData, setBacktestData] = useState<Strategy['backtestData'] | null>(null);
  const [uploadingBacktest, setUploadingBacktest] = useState(false);
  const [showBacktestUpload, setShowBacktestUpload] = useState(false);
  const [showPropertiesModal, setShowPropertiesModal] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    try {
      setLoading(true);
      const data = await strategiesAPI.getAll();
      setStrategies(data || []);
      if (data && data.length > 0 && !selectedStrategy) {
        setSelectedStrategy(data[0]);
      }
    } catch (error) {
      console.error('Error loading strategies:', error);
      setStrategies([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setModalMode('create');
    setFormData({
      name: '',
      status: 'inactive',
      strategyType: 'tradingview',
      entrySignal: 'RSI Oversold',
      exitSignal: 'Take Profit 3%',
      positionSize: 5000,
      maxPositions: 5,
      riskPerTrade: '2%',
      tradingHoursStart: '09:30',
      tradingHoursEnd: '16:00',
      symbols: 'AAPL, TSLA, NVDA, MSFT, GOOGL',
    });
    setShowModal(true);
  };

  const handleEdit = (strategy: Strategy) => {
    setModalMode('edit');
    setFormData({
      name: strategy.name,
      status: strategy.status,
      strategyType: strategy.strategyType,
      entrySignal: strategy.entrySignal || 'RSI Oversold',
      exitSignal: strategy.exitSignal || 'Take Profit 3%',
      positionSize: strategy.positionSize || 5000,
      maxPositions: strategy.maxPositions || 5,
      riskPerTrade: strategy.riskPerTrade || '2%',
      maxDailyLoss: strategy.maxDailyLoss || 500,
      tradingHoursStart: strategy.tradingHoursStart || '09:30',
      tradingHoursEnd: strategy.tradingHoursEnd || '16:00',
      symbols: strategy.symbols || 'AAPL, TSLA, NVDA, MSFT, GOOGL',
    });
    setBacktestData(strategy.backtestData || null);
    setSelectedStrategy(strategy);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      const dataToSave = {
        ...formData,
        ...(backtestData && { backtestData }),
      };
      
      if (modalMode === 'create') {
        await strategiesAPI.create(dataToSave);
        console.log('✅ Strategy created successfully');
      } else if (selectedStrategy) {
        await strategiesAPI.update(selectedStrategy.id, dataToSave);
        console.log('✅ Strategy updated successfully');
      }
      
      await loadStrategies();
      setShowModal(false);
      setBacktestData(null);
      setBacktestFile(null);
    } catch (error: any) {
      console.error('Error saving strategy:', error);
      alert(error.message || 'Failed to save strategy');
    } finally {
      setSaving(false);
    }
  };

  const handleClearRiskSettings = async () => {
    if (!confirm('This will clear all risk settings (max positions, daily loss limits, trading hours, symbol restrictions) for ALL strategies. Orders will execute without any blocking. Continue?')) return;
    
    try {
      setSaving(true);
      const token = getAccessToken() || publicAnonKey;
      const response = await fetch(buildFunctionUrl('/strategies/clear-risk-settings'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to clear risk settings' }));
        throw new Error(errorData.error || 'Failed to clear risk settings');
      }
      
      const result = await response.json();
      alert(`✅ Success! Risk settings cleared for ${result.updatedCount} strategies. All orders will now execute without blocking.`);
      await loadStrategies();
    } catch (error: any) {
      console.error('Error clearing risk settings:', error);
      alert('Failed to clear risk settings: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (strategyId: string) => {
    if (!confirm('Are you sure you want to delete this strategy?')) return;
    
    try {
      await strategiesAPI.delete(strategyId);
      console.log('✅ Strategy deleted successfully');
      
      // If deleted strategy was selected, clear selection
      if (selectedStrategy?.id === strategyId) {
        setSelectedStrategy(null);
      }
      
      await loadStrategies();
    } catch (error) {
      console.error('Error deleting strategy:', error);
      alert('Failed to delete strategy');
    }
  };

  const handleToggleStatus = async (strategy: Strategy) => {
    try {
      const newStatus = strategy.status === 'active' ? 'paused' : 'active';
      await strategiesAPI.update(strategy.id, { status: newStatus });
      console.log(`✅ Strategy ${newStatus === 'active' ? 'activated' : 'paused'}`);
      await loadStrategies();
    } catch (error) {
      console.error('Error toggling strategy status:', error);
      alert('Failed to update strategy status');
    }
  };

  const handleBacktestFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
      alert('Please upload an Excel file (.xlsx, .xls) or CSV file');
      return;
    }

    setBacktestFile(file);
    setUploadingBacktest(true);

    try {
      const parsedData = await parseBacktestFile(file);
      setBacktestData(parsedData);
      console.log('✅ Backtest data parsed:', parsedData);
      alert('Backtest data uploaded successfully! Click Save to attach it to the strategy.');
    } catch (error: any) {
      console.error('Error parsing backtest file:', error);
      alert(error.message || 'Failed to parse backtest file. Please ensure it\'s in the correct format (TradingView Strategy Tester export).');
    } finally {
      setUploadingBacktest(false);
    }
  };

  const handleManualBacktestEntry = () => {
    setShowBacktestUpload(true);
  };

  const handleBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStrategy) return;
    setBacktesting(true);
    setShowBacktestModal(false);
    try {
      const results = await strategiesAPI.backtest(selectedStrategy.id, backtestConfig);
      setBacktestResults(results.results);
      setShowBacktestResults(true);
    } catch (error: any) {
      console.error('Error running backtest:', error);
      alert(error.message || 'Failed to run backtest');
    } finally {
      setBacktesting(false);
    }
  };

  const loadStrategyTrades = async (strategyId: string, syncFirst = true) => {
    try {
      setLoadingTrades(true);
      
      // First sync with Alpaca to get latest data
      if (syncFirst) {
        console.log('Syncing trades with Alpaca...');
        try {
          const syncResult = await strategiesAPI.syncTrades(strategyId);
          console.log('Sync result:', syncResult);
        } catch (syncError) {
          console.error('Error syncing trades:', syncError);
          // Continue loading even if sync fails
        }
      }
      
      // Then fetch the trades
      const trades = await strategiesAPI.getTrades(strategyId);
      setStrategyTrades(trades || []);
    } catch (error) {
      console.error('Error loading strategy trades:', error);
      setStrategyTrades([]);
    } finally {
      setLoadingTrades(false);
    }
  };

  const copyWebhookUrl = (url: string) => {
    copyToClipboard(url);
  };

  const debugTrades = async () => {
    try {
      const response = await fetch(buildFunctionUrl('/debug/trades'), {
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch debug info');
      }
      
      const data = await response.json();
      console.log('🔍 DEBUG TRADES INFO:');
      console.log(`Total trades: ${data.totalTrades}`);
      console.log(`Total strategies: ${data.totalStrategies}`);
      console.log('Strategy Map:', data.strategyMap);
      console.log('Strategy Name to ID:', data.strategyNameToId);
      console.log('Trades by Strategy:', data.tradesByStrategy);
      console.log('Orphaned Trades:', data.orphanedTrades);
      
      if (data.orphanedTrades && data.orphanedTrades.length > 0) {
        const fix = confirm(`Found ${data.orphanedTrades.length} orphaned trades (check console for details). Fix them now?`);
        if (fix) {
          await fixTrades();
        }
      } else {
        alert(`Debug info logged to console. Total trades: ${data.totalTrades}, Strategies: ${data.totalStrategies}, No orphaned trades found.`);
      }
    } catch (error) {
      console.error('Error fetching debug info:', error);
      alert('Failed to fetch debug info');
    }
  };

  const fixTrades = async () => {
    try {
      const response = await fetch(buildFunctionUrl('/debug/fix-trades'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fix trades');
      }
      
      const data = await response.json();
      console.log('✅ FIX TRADES RESULT:', data);
      console.log('Updates:', data.updates);
      
      alert(`Fixed ${data.fixedCount} trades! Refreshing...`);
      
      // Reload strategies and trades
      await loadStrategies();
      if (selectedStrategy?.id) {
        await loadStrategyTrades(selectedStrategy.id, false);
      }
    } catch (error) {
      console.error('Error fixing trades:', error);
      alert('Failed to fix trades');
    }
  };

  // Load trades when selected strategy changes
  useEffect(() => {
    if (selectedStrategy?.id) {
      loadStrategyTrades(selectedStrategy.id);
    }
  }, [selectedStrategy?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading strategies...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="mb-2 text-slate-100">Trading Strategies</h2>
          <p className="text-slate-400">Configure and monitor your algorithmic strategies</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleClearRiskSettings}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400 transition-colors hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Remove all risk management restrictions from all strategies"
          >
            <AlertTriangle className="h-4 w-4" />
            {saving ? 'Clearing...' : 'Clear All Risk Settings'}
          </button>
          <button 
            onClick={debugTrades}
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm transition-colors hover:bg-slate-700"
            title="Debug trades (check console)"
          >
            <Search className="h-4 w-4" />
            Debug Trades
          </button>
          <button 
            onClick={handleCreateNew}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-3 transition-colors hover:bg-blue-600"
          >
            <Play className="h-5 w-5" />
            Deploy New Strategy
          </button>
        </div>
      </div>

      {strategies.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <div className="mb-4 text-slate-400">
            <BarChart3 className="w-16 h-16 mx-auto mb-4" />
          </div>
          <h3 className="text-xl text-white mb-2">No Strategies Yet</h3>
          <p className="text-slate-400 mb-6 max-w-md">
            Create your first algorithmic trading strategy to automate your trading decisions.
          </p>
          <button 
            onClick={handleCreateNew}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 transition-colors hover:bg-blue-600"
          >
            <Play className="h-5 w-5" />
            Deploy New Strategy
          </button>
        </div>
      ) : (
        <>
          {/* Two-Column Layout: Strategies Left, Details Right */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column: Strategy List */}
            <div className="space-y-6">
              {strategies.map((strategy) => (
              <div
                key={strategy.id}
                onClick={() => setSelectedStrategy(strategy)}
                className={`cursor-pointer rounded-xl border bg-slate-900/30 p-6 backdrop-blur-sm transition-all hover:border-slate-600/50 ${
                  selectedStrategy?.id === strategy.id
                    ? 'border-blue-500/50'
                    : 'border-slate-700/50'
                }`}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="mb-1 text-slate-100">{strategy.name}</h3>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                          strategy.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : strategy.status === 'paused'
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${
                            strategy.status === 'active'
                              ? 'bg-emerald-400'
                              : strategy.status === 'paused'
                              ? 'bg-yellow-400'
                              : 'bg-slate-600'
                          }`}
                        ></div>
                        {strategy.status.charAt(0).toUpperCase() + strategy.status.slice(1)}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
                        strategy.strategyType === 'tradingview'
                          ? 'bg-blue-500/10 text-blue-400'
                          : 'bg-purple-500/10 text-purple-400'
                      }`}>
                        {strategy.strategyType === 'tradingview' ? '🔗 TradingView' : '⚙️ Manual'}
                      </span>
                      {strategy.createdAt && (
                        <span className="text-xs text-slate-500">
                          Created: {new Date(strategy.createdAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(strategy);
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
                    >
                      <Settings className="h-5 w-5" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(strategy.id);
                      }}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-400"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {strategy.strategyType === 'tradingview' ? (
                  <div className="grid grid-cols-1 gap-2">
                    <div className="rounded-lg bg-blue-500/10 p-3">
                      <p className="text-xs text-blue-400 mb-1">🔗 TradingView Webhook Strategy</p>
                      <p className="text-xs text-slate-400">
                        Trades executed automatically from TradingView alerts
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Entry Signal</p>
                      <p className="text-sm text-slate-100">{strategy.entrySignal || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Exit Signal</p>
                      <p className="text-sm text-slate-100">{strategy.exitSignal || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Position Size</p>
                      <p className="font-mono text-sm text-slate-100">${strategy.positionSize?.toLocaleString() || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs text-slate-500">Risk Per Trade</p>
                      <p className="font-mono text-sm text-slate-100">{strategy.riskPerTrade || 'N/A'}</p>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  {strategy.status === 'active' ? (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStatus(strategy);
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-500/10 py-2 text-sm text-yellow-400 transition-colors hover:bg-yellow-500/20"
                    >
                      <Pause className="h-4 w-4" />
                      Pause
                    </button>
                  ) : (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleStatus(strategy);
                      }}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500/10 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/20"
                    >
                      <Play className="h-4 w-4" />
                      Activate
                    </button>
                  )}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(strategy);
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
                  >
                    <Settings className="h-4 w-4" />
                    Configure
                  </button>
                </div>
              </div>
            ))}
          </div>

            {/* Right Column: Strategy Details */}
            {selectedStrategy && (
              <div className="space-y-6">
                {/* TradingView Webhook - Only shown for TradingView strategies */}
                {selectedStrategy.strategyType === 'tradingview' && selectedStrategy.webhookUrl && (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-slate-100">TradingView Webhook</h3>
                      <div className="px-2 py-1 rounded-md bg-blue-500/20 border border-blue-500/30">
                        <p className="text-[10px] text-blue-400 font-mono">UNIQUE</p>
                      </div>
                    </div>
                    <p className="mb-2 text-xs text-slate-400">
                      ✨ This is a <span className="text-blue-400 font-semibold">unique webhook URL</span> specific to this strategy only.
                    </p>
                    <p className="mb-3 text-xs text-slate-500">
                      Use this URL in TradingView alerts to track performance for &quot;{selectedStrategy.name}&quot;.
                    </p>
                    
                    {/* Strategy Name Display */}
                    <div className="mb-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                      <p className="text-[10px] text-slate-500 mb-1">Strategy:</p>
                      <p className="text-sm font-semibold text-blue-400">{selectedStrategy.name}</p>
                    </div>
                    
                    {/* Webhook URL */}
                    <div className="flex gap-2 mb-3">
                      <input
                        type="text"
                        value={selectedStrategy.webhookUrl}
                        readOnly
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 font-mono text-xs text-slate-300 outline-none"
                      />
                      <button
                        onClick={() => copyWebhookUrl(selectedStrategy.webhookUrl!)}
                        className="rounded-lg border border-slate-700 bg-slate-800/50 p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-400"
                        title="Copy webhook URL"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400 mb-3">
                      <p className="flex items-center gap-1">
                        <span>✓</span>
                        <span>All trades from this webhook will be tracked separately for this strategy</span>
                      </p>
                    </div>
                    
                    <div className="rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-400">
                      <p className="mb-1 font-semibold">⚠️ Webhook Payload Format:</p>
                      <pre className="block text-[10px] text-slate-400 bg-slate-900/50 p-2 rounded mt-2 overflow-x-auto whitespace-pre">{JSON.stringify({ action: "buy", symbol: "AAPL", quantity: 10, price: 150.50 }, null, 2)}</pre>
                    </div>
                  </div>
                )}

                {/* View Trades Button - Only shown for TradingView strategies */}
                {selectedStrategy.strategyType === 'tradingview' && (
                  <button
                    onClick={() => setShowTradesPanel(true)}
                    className="w-full rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 backdrop-blur-sm transition-colors hover:bg-emerald-500/20"
                  >
                    <div className="mb-2 flex items-center justify-center gap-2 text-emerald-400">
                      <Activity className="h-5 w-5" />
                      <span className="text-sm">View Strategy Trades</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {strategyTrades.length} trade{strategyTrades.length !== 1 ? 's' : ''} tracked for <span className="text-emerald-400 font-semibold">&quot;{selectedStrategy.name}&quot;</span>
                    </p>
                  </button>
                )}

                {/* Strategy Info Panel */}
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
                  <h3 className="mb-4 text-slate-100">Strategy Info</h3>
                  <div className="space-y-4">
                    {selectedStrategy.strategyType === 'tradingview' && (
                      <div className="pb-3 border-b border-slate-700/50">
                        <p className="text-xs text-slate-500 mb-1">Strategy Name</p>
                        <p className="text-lg font-semibold text-blue-400 break-all">{selectedStrategy.name}</p>
                      </div>
                    )}
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Type"
                      value={selectedStrategy.strategyType === 'tradingview' ? 'TradingView' : 'Manual'}
                      color={selectedStrategy.strategyType === 'tradingview' ? 'text-blue-400' : 'text-purple-400'}
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Status"
                      value={selectedStrategy.status.charAt(0).toUpperCase() + selectedStrategy.status.slice(1)}
                      color={
                        selectedStrategy.status === 'active' 
                          ? 'text-emerald-400' 
                          : selectedStrategy.status === 'paused'
                          ? 'text-yellow-400'
                          : 'text-slate-400'
                      }
                    />
                    <MetricRow
                      icon={<Clock className="h-5 w-5" />}
                      label="Created"
                      value={selectedStrategy.createdAt ? new Date(selectedStrategy.createdAt).toLocaleDateString() : 'N/A'}
                      color="text-slate-400"
                    />
                    {selectedStrategy.updatedAt && (
                      <MetricRow
                        icon={<Clock className="h-5 w-5" />}
                        label="Last Updated"
                        value={new Date(selectedStrategy.updatedAt).toLocaleDateString()}
                        color="text-slate-400"
                      />
                    )}
                    <MetricRow
                      icon={<BarChart3 className="h-5 w-5" />}
                      label="Max Positions"
                      value={selectedStrategy.maxPositions.toString()}
                      color="text-blue-400"
                    />
                    <MetricRow
                      icon={<DollarSign className="h-5 w-5" />}
                      label="Position Size"
                      value={`$${selectedStrategy.positionSize.toLocaleString()}`}
                      color="text-cyan-400"
                    />
                  </div>
                </div>

                {/* Backtest vs Actual Performance Comparison */}
                {selectedStrategy.backtestData && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-slate-100">Backtest vs Actual Performance</h3>
                      <div className="flex items-center gap-2">
                        {onNavigate && (
                          <button
                            onClick={() => onNavigate('performance')}
                            className="px-3 py-1.5 rounded-md bg-blue-500/20 border border-blue-500/30 text-xs text-blue-400 hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                          >
                            <BarChart3 className="h-3 w-3" />
                            View Detailed Analysis
                          </button>
                        )}
                        <div className="px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/30">
                          <p className="text-[10px] text-emerald-400 font-mono">COMPARISON</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      {/* Backtest Data */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <FileSpreadsheet className="h-4 w-4 text-blue-400" />
                          <p className="text-sm text-blue-400">Backtest Results (TradingView)</p>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Initial Capital</p>
                            <p className="font-mono text-sm text-slate-300">
                              ${selectedStrategy.backtestData.initialCapital.toLocaleString()}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Net Profit</p>
                            <p className={`font-mono text-sm ${selectedStrategy.backtestData.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              ${safeToFixed(selectedStrategy.backtestData.netProfit, 2)}
                            </p>
                            <p className={`font-mono text-xs ${selectedStrategy.backtestData.netProfitPercent >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                              ({safeToFixed(selectedStrategy.backtestData.netProfitPercent, 2)}%)
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Max Equity Drawdown</p>
                            <p className="font-mono text-sm text-rose-400">
                              ${safeToFixed(Math.abs(safeNumber(selectedStrategy.backtestData.maxEquityDrawdown)), 2)}
                            </p>
                            <p className="font-mono text-xs text-rose-400/70">
                              ({safeToFixed(selectedStrategy.backtestData.maxEquityDrawdownPercent, 2)}%)
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Total Trades</p>
                            <p className="font-mono text-sm text-slate-300">
                              {selectedStrategy.backtestData.totalTrades}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Winning Trades</p>
                            <p className="font-mono text-sm text-emerald-400">
                              {selectedStrategy.backtestData.winningTrades}
                            </p>
                            <p className="font-mono text-xs text-emerald-400/70">
                              ({safeToFixed(selectedStrategy.backtestData.percentProfitable, 2)}%)
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Losing Trades</p>
                            <p className="font-mono text-sm text-rose-400">
                              {selectedStrategy.backtestData.losingTrades}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Avg P&L</p>
                            <p className={`font-mono text-sm ${selectedStrategy.backtestData.avgPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              ${safeToFixed(selectedStrategy.backtestData.avgPnL, 2)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Avg Winning Trade</p>
                            <p className="font-mono text-sm text-emerald-400">
                              ${safeToFixed(selectedStrategy.backtestData.avgWinningTrade, 2)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Avg Losing Trade</p>
                            <p className="font-mono text-sm text-rose-400">
                              ${safeToFixed(Math.abs(safeNumber(selectedStrategy.backtestData.avgLosingTrade)), 2)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Ratio Avg Win / Avg Loss</p>
                            <p className="font-mono text-sm text-cyan-400">
                              {safeToFixed(selectedStrategy.backtestData.ratioAvgWinLoss, 2)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Sharpe Ratio</p>
                            <p className="font-mono text-sm text-blue-400">
                              {safeToFixed(selectedStrategy.backtestData.sharpeRatio, 2)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-800/50 p-3">
                            <p className="text-xs text-slate-500 mb-1">Profit Factor</p>
                            <p className="font-mono text-sm text-purple-400">
                              {safeToFixed(selectedStrategy.backtestData.profitFactor, 2)}
                            </p>
                          </div>
                        </div>
                        
                        {/* Properties section */}
                        {selectedStrategy.backtestData.properties && Object.keys(selectedStrategy.backtestData.properties).length > 0 && (
                          <div className="mt-3 rounded-lg bg-slate-800/30 border border-slate-700 p-3">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs text-slate-500">Strategy Properties:</p>
                              <button
                                onClick={() => {
                                  setSelectedProperties(selectedStrategy.backtestData.properties || null);
                                  setShowPropertiesModal(true);
                                }}
                                className="px-2 py-1 rounded-md bg-blue-500/20 border border-blue-500/30 text-[10px] text-blue-400 hover:bg-blue-500/30 transition-colors"
                              >
                                View All
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 font-mono max-h-32 overflow-y-auto">
                              {Object.entries(selectedStrategy.backtestData.properties).slice(0, 4).map(([key, value]) => (
                                <div key={key} className="truncate">
                                  <span className="text-slate-500">{key}:</span> <span className="text-slate-300">{String(value)}</span>
                                </div>
                              ))}
                            </div>
                            {Object.keys(selectedStrategy.backtestData.properties).length > 4 && (
                              <p className="text-[10px] text-slate-500 mt-2 text-center">
                                +{Object.keys(selectedStrategy.backtestData.properties).length - 4} more properties
                              </p>
                            )}
                          </div>
                        )}
                        
                        {selectedStrategy.backtestData.fileName && (
                          <p className="text-xs text-slate-500 mt-2">
                            Source: {selectedStrategy.backtestData.fileName}
                          </p>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-700/50">
                        <div className="flex items-center gap-2 mb-2">
                          <Activity className="h-4 w-4 text-emerald-400" />
                          <p className="text-sm text-emerald-400">Actual Performance (Live Trading)</p>
                        </div>
                        {livePerformanceMetrics ? (
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Net P&amp;L</p>
                              <p className={`font-mono text-sm ${livePerformanceMetrics.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                ${safeToFixed(livePerformanceMetrics.totalPnL, 2)}
                              </p>
                              <p className={`font-mono text-xs ${livePerformanceMetrics.totalPnLPercent >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                                ({safeToFixed(livePerformanceMetrics.totalPnLPercent, 2)}%)
                              </p>
                            </div>
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Win Rate</p>
                              <p className="font-mono text-sm text-emerald-400">{safeToFixed(livePerformanceMetrics.winRate, 2)}%</p>
                            </div>
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Profit Factor</p>
                              <p className="font-mono text-sm text-cyan-400">{safeToFixed(livePerformanceMetrics.profitFactor, 2)}</p>
                            </div>
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Max Drawdown</p>
                              <p className="font-mono text-sm text-rose-400">{safeToFixed(livePerformanceMetrics.maxDrawdownPercent, 2)}%</p>
                            </div>
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Expectancy</p>
                              <p className={`font-mono text-sm ${livePerformanceMetrics.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                ${safeToFixed(livePerformanceMetrics.expectancy, 2)}
                              </p>
                            </div>
                            <div className="rounded-lg bg-slate-800/50 p-3">
                              <p className="text-xs text-slate-500 mb-1">Closed Trades</p>
                              <p className="font-mono text-sm text-slate-300">{livePerformanceMetrics.totalTrades}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg bg-slate-800/30 border border-slate-700 p-4">
                            <p className="text-xs text-slate-400 text-center">
                              Live metrics populate from executed trades linked to this strategy.
                            </p>
                            <p className="text-xs text-slate-500 text-center mt-1">
                              No closed trades found yet for a real comparison.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setShowBacktestModal(true)}
                  className="w-full rounded-xl border border-blue-500/50 bg-blue-500/10 p-4 backdrop-blur-sm transition-colors hover:bg-blue-500/20"
                >
                  <div className="mb-2 flex items-center justify-center gap-2 text-blue-400">
                    <BarChart3 className="h-5 w-5" />
                    <span className="text-sm">Run Backtest</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Test this strategy against historical data to evaluate performance.
                  </p>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowModal(false)}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-300"
            >
              <X className="h-6 w-6" />
            </button>

            <h3 className="mb-2 text-slate-100">
              {modalMode === 'create' ? 'Deploy New Strategy' : 'Edit Strategy'}
            </h3>
            <p className="mb-6 text-sm text-slate-400">
              {modalMode === 'create' 
                ? 'Configure your algorithmic trading strategy parameters' 
                : 'Update your strategy configuration'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Strategy Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  placeholder="e.g., Mean Reversion Alpha"
                  required
                />
              </div>

              <div>
                <label className="mb-3 block text-sm text-slate-300">Strategy Type *</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, strategyType: 'tradingview' })}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      formData.strategyType === 'tradingview'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                        formData.strategyType === 'tradingview'
                          ? 'border-blue-500'
                          : 'border-slate-600'
                      }`}>
                        {formData.strategyType === 'tradingview' && (
                          <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                        )}
                      </div>
                      <span className={`text-sm ${
                        formData.strategyType === 'tradingview' ? 'text-blue-400' : 'text-slate-400'
                      }`}>
                        TradingView Webhook
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Automatically execute trades from TradingView alerts via webhook URL
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, strategyType: 'manual' })}
                    className={`rounded-xl border p-4 text-left transition-all ${
                      formData.strategyType === 'manual'
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                        formData.strategyType === 'manual'
                          ? 'border-blue-500'
                          : 'border-slate-600'
                      }`}>
                        {formData.strategyType === 'manual' && (
                          <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                        )}
                      </div>
                      <span className={`text-sm ${
                        formData.strategyType === 'manual' ? 'text-blue-400' : 'text-slate-400'
                      }`}>
                        Manual/Algorithmic
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      For backtesting or custom algorithmic execution without webhooks
                    </p>
                  </button>
                </div>
              </div>

              {/* Manual Strategy Parameters - Only shown for Manual/Algorithmic type */}
              {formData.strategyType === 'manual' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Entry Signal</label>
                      <select 
                        value={formData.entrySignal}
                        onChange={(e) => setFormData({ ...formData, entrySignal: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-slate-300 outline-none transition-colors focus:border-blue-500"
                      >
                        <option>RSI Oversold</option>
                        <option>MACD Cross</option>
                        <option>Bollinger Band Touch</option>
                        <option>Moving Average Crossover</option>
                        <option>Volume Breakout</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Exit Signal</label>
                      <select 
                        value={formData.exitSignal}
                        onChange={(e) => setFormData({ ...formData, exitSignal: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-slate-300 outline-none transition-colors focus:border-blue-500"
                      >
                        <option>Take Profit 3%</option>
                        <option>Trailing Stop</option>
                        <option>Time Exit</option>
                        <option>ATR-based Stop</option>
                        <option>Support/Resistance</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Position Size ($)</label>
                      <input
                        type="number"
                        value={formData.positionSize}
                        onChange={(e) => setFormData({ ...formData, positionSize: parseInt(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                        min="100"
                        step="100"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Max Positions</label>
                      <input
                        type="number"
                        value={formData.maxPositions}
                        onChange={(e) => setFormData({ ...formData, maxPositions: parseInt(e.target.value) || 1 })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                        min="1"
                        max="20"
                        required
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Risk Per Trade</label>
                      <input
                        type="text"
                        value={formData.riskPerTrade}
                        onChange={(e) => setFormData({ ...formData, riskPerTrade: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                        placeholder="2%"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-300">
                      Max Daily Loss ($)
                      <span className="ml-2 text-xs text-slate-500">Trading pauses when limit is reached</span>
                    </label>
                    <input
                      type="number"
                      value={formData.maxDailyLoss}
                      onChange={(e) => setFormData({ ...formData, maxDailyLoss: parseInt(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                      min="0"
                      step="50"
                      placeholder="500"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Trading Hours</label>
                    <div className="grid grid-cols-2 gap-4">
                      <input
                        type="time"
                        value={formData.tradingHoursStart}
                        onChange={(e) => setFormData({ ...formData, tradingHoursStart: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                      />
                      <input
                        type="time"
                        value={formData.tradingHoursEnd}
                        onChange={(e) => setFormData({ ...formData, tradingHoursEnd: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Symbols (comma-separated)</label>
                    <input
                      type="text"
                      value={formData.symbols}
                      onChange={(e) => setFormData({ ...formData, symbols: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                      placeholder="AAPL, TSLA, NVDA, MSFT, GOOGL"
                      required
                    />
                  </div>
                </>
              )}

              {/* TradingView Strategy Info */}
              {formData.strategyType === 'tradingview' && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="px-2 py-1 rounded bg-blue-500/20 border border-blue-500/40">
                        <p className="text-[10px] text-blue-400 font-mono">UNIQUE URL</p>
                      </div>
                      <p className="text-sm text-blue-300 font-semibold">Individual Performance Tracking</p>
                    </div>
                    <ul className="space-y-2 text-xs text-slate-300">
                      <li className="flex items-start gap-2">
                        <span className="text-blue-400 mt-0.5">✓</span>
                        <span>A <strong className="text-blue-400">unique webhook URL</strong> will be generated specifically for this strategy</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-emerald-400 mt-0.5">✓</span>
                        <span>All trades from this webhook will be <strong className="text-emerald-400">tracked separately</strong></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-cyan-400 mt-0.5">✓</span>
                        <span>Performance metrics (P/L, win rate) calculated <strong className="text-cyan-400">only for this strategy</strong></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-purple-400 mt-0.5">✓</span>
                        <span>Create multiple TradingView strategies - each gets its own URL for independent tracking</span>
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 border border-slate-700 p-3 text-xs text-slate-400">
                    <p className="mb-1 text-slate-300 font-semibold">How it works:</p>
                    <p>1. Strategy created → Unique URL generated with strategy ID</p>
                    <p>2. Add URL to TradingView alert for this specific strategy</p>
                    <p>3. TradingView sends signals → Trades execute & get tagged with strategy ID</p>
                    <p>4. View isolated performance metrics for this strategy only</p>
                  </div>
                </div>
              )}

              {/* Backtest Data Upload Section */}
              <div className="space-y-3 border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm text-slate-300 mb-1">
                      Backtest Results (Optional)
                    </label>
                    <p className="text-xs text-slate-500">
                      Upload TradingView backtest data to compare with actual performance
                    </p>
                  </div>
                  <img src={exampleImage} alt="TradingView Backtest" className="h-12 rounded border border-slate-700" />
                </div>

                {backtestData ? (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-emerald-400" />
                        <span className="text-sm text-emerald-400">Backtest data loaded</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBacktestData(null);
                          setBacktestFile(null);
                        }}
                        className="text-xs text-slate-400 hover:text-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs max-h-80 overflow-y-auto">
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Initial Capital</p>
                        <p className="font-mono text-slate-300">
                          ${backtestData.initialCapital.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Net Profit</p>
                        <p className={`font-mono ${backtestData.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ${safeToFixed(backtestData.netProfit, 2)}
                        </p>
                        <p className={`font-mono text-[10px] ${backtestData.netProfitPercent >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                          ({safeToFixed(backtestData.netProfitPercent, 2)}%)
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Max Equity Drawdown</p>
                        <p className="font-mono text-rose-400">
                          ${safeToFixed(Math.abs(safeNumber(backtestData.maxEquityDrawdown)), 2)}
                        </p>
                        <p className="font-mono text-[10px] text-rose-400/70">
                          ({safeToFixed(backtestData.maxEquityDrawdownPercent, 2)}%)
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Total Trades</p>
                        <p className="font-mono text-slate-300">{backtestData.totalTrades}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Winning Trades</p>
                        <p className="font-mono text-emerald-400">
                          {backtestData.winningTrades}
                        </p>
                        <p className="font-mono text-[10px] text-emerald-400/70">
                          ({safeToFixed(backtestData.percentProfitable, 2)}%)
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Losing Trades</p>
                        <p className="font-mono text-rose-400">{backtestData.losingTrades}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Percent Profitable</p>
                        <p className="font-mono text-blue-400">{safeToFixed(backtestData.percentProfitable, 2)}%</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Avg P&L</p>
                        <p className={`font-mono ${backtestData.avgPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ${safeToFixed(backtestData.avgPnL, 2)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Avg Winning Trade</p>
                        <p className="font-mono text-emerald-400">${safeToFixed(backtestData.avgWinningTrade, 2)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Avg Losing Trade</p>
                        <p className="font-mono text-rose-400">${safeToFixed(Math.abs(safeNumber(backtestData.avgLosingTrade)), 2)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Ratio Avg Win / Avg Loss</p>
                        <p className="font-mono text-cyan-400">{safeToFixed(backtestData.ratioAvgWinLoss, 2)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Sharpe Ratio</p>
                        <p className="font-mono text-blue-400">{safeToFixed(backtestData.sharpeRatio, 2)}</p>
                      </div>
                      <div className="rounded-lg bg-slate-800/50 p-2">
                        <p className="text-slate-500">Profit Factor</p>
                        <p className="font-mono text-purple-400">{safeToFixed(backtestData.profitFactor, 2)}</p>
                      </div>
                      {backtestData.properties && Object.keys(backtestData.properties).length > 0 && (
                        <div className="rounded-lg bg-slate-800/50 p-2 col-span-2">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-slate-500">Properties</p>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProperties(backtestData.properties || null);
                                setShowPropertiesModal(true);
                              }}
                              className="px-2 py-0.5 rounded-md bg-blue-500/20 border border-blue-500/30 text-[9px] text-blue-400 hover:bg-blue-500/30 transition-colors"
                            >
                              View All
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono space-y-0.5 max-h-20 overflow-y-auto">
                            {Object.entries(backtestData.properties).slice(0, 3).map(([key, value]) => (
                              <div key={key} className="truncate">
                                {key}: {String(value)}
                              </div>
                            ))}
                          </div>
                          {Object.keys(backtestData.properties).length > 3 && (
                            <p className="text-[9px] text-slate-500 mt-1">
                              +{Object.keys(backtestData.properties).length - 3} more
                            </p>
                          )}
                        </div>
                      )}
                      <div className="rounded-lg bg-slate-800/50 p-2 col-span-2">
                        <p className="text-slate-500">File</p>
                        <p className="font-mono text-slate-400 truncate" title={backtestData.fileName}>
                          {backtestData.fileName}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="backtest-upload"
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-700 bg-slate-800/30 p-6 transition-colors hover:border-blue-500 hover:bg-slate-800/50"
                    >
                      {uploadingBacktest ? (
                        <>
                          <RefreshCw className="h-5 w-5 animate-spin text-blue-400" />
                          <span className="text-sm text-blue-400">Parsing file...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-5 w-5 text-slate-400" />
                          <span className="text-sm text-slate-400">
                            Upload Excel/CSV with backtest results
                          </span>
                        </>
                      )}
                    </label>
                    <input
                      id="backtest-upload"
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleBacktestFileUpload}
                      className="hidden"
                      disabled={uploadingBacktest}
                    />
                    <p className="mt-2 text-xs text-slate-500 text-center">
                      Supports TradingView Strategy Tester export (.xlsx, .xls, .csv)
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Initial Status</label>
                <select 
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-slate-300 outline-none transition-colors focus:border-blue-500"
                >
                  <option value="inactive">Inactive (Draft)</option>
                  <option value="active">Active (Live Trading)</option>
                  <option value="paused">Paused</option>
                </select>
              </div>

              {formData.strategyType === 'manual' && (
                <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-300">
                  <p className="flex items-start gap-2">
                    <span className="mt-0.5">ℹ️</span>
                    <span>
                      Strategies can be activated or paused at any time. Start with "Inactive" to test your configuration.
                    </span>
                  </p>
                </div>
              )}

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
                  className={`flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 ${
                    saving ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : modalMode === 'create' ? 'Deploy Strategy' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Backtest Modal */}
      {showBacktestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowBacktestModal(false)}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-300"
            >
              <X className="h-6 w-6" />
            </button>

            <h3 className="mb-2 text-slate-100">Backtest Strategy</h3>
            <p className="mb-6 text-sm text-slate-400">
              Configure the backtest parameters for your strategy.
            </p>

            <form onSubmit={handleBacktest} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Start Date</label>
                <input
                  type="date"
                  value={backtestConfig.startDate}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, startDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">End Date</label>
                <input
                  type="date"
                  value={backtestConfig.endDate}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, endDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Initial Capital ($)</label>
                <input
                  type="number"
                  value={backtestConfig.initialCapital}
                  onChange={(e) => setBacktestConfig({ ...backtestConfig, initialCapital: parseInt(e.target.value) || 100000 })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 font-mono text-slate-300 outline-none transition-colors focus:border-blue-500"
                  min="1000"
                  step="1000"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBacktestModal(false)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-800/50 py-3 text-slate-300 transition-colors hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 rounded-lg bg-blue-500 py-3 transition-colors hover:bg-blue-600 ${
                    backtesting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  disabled={backtesting}
                >
                  {backtesting ? 'Running...' : 'Run Backtest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Backtest Results Modal */}
      {showBacktestResults && backtestResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-4xl rounded-2xl border border-slate-700/50 bg-slate-900 p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowBacktestResults(false)}
              className="absolute right-4 top-4 text-slate-400 transition-colors hover:text-slate-300"
            >
              <X className="h-6 w-6" />
            </button>

            <h3 className="mb-2 text-slate-100">Backtest Results</h3>
            <p className="mb-6 text-sm text-slate-400">
              Performance metrics for your strategy backtest.
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Equity Curve Chart */}
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
                <h3 className="mb-4 text-slate-100">Equity Curve</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={backtestResults.equityCurve}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="equity" stroke="#8884d8" activeDot={{ r: 8 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Performance Metrics */}
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm">
                  <h3 className="mb-4 text-slate-100">Performance Metrics</h3>
                  <div className="space-y-4">
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Total Trades"
                      value={backtestResults.totalTrades.toString()}
                      color="text-blue-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Winning Trades"
                      value={backtestResults.winningTrades.toString()}
                      color="text-emerald-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Losing Trades"
                      value={backtestResults.losingTrades.toString()}
                      color="text-red-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Win Rate"
                      value={`${safeToFixed(backtestResults.winRate, 2)}%`}
                      color="text-emerald-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Total Return"
                      value={`${safeToFixed(backtestResults.totalReturn, 2)}%`}
                      color="text-emerald-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Final Equity"
                      value={`$${backtestResults.finalEquity.toLocaleString()}`}
                      color="text-cyan-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Initial Capital"
                      value={`$${backtestResults.initialCapital.toLocaleString()}`}
                      color="text-cyan-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Net Profit"
                      value={`$${backtestResults.netProfit.toLocaleString()}`}
                      color="text-cyan-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Average Win"
                      value={`$${backtestResults.avgWin.toLocaleString()}`}
                      color="text-emerald-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Average Loss"
                      value={`$${backtestResults.avgLoss.toLocaleString()}`}
                      color="text-red-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Profit Factor"
                      value={safeToFixed(backtestResults.profitFactor, 2)}
                      color="text-emerald-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Max Drawdown"
                      value={`${safeToFixed(backtestResults.maxDrawdown, 2)}%`}
                      color="text-red-400"
                    />
                    <MetricRow
                      icon={<TrendingUp className="h-5 w-5" />}
                      label="Sharpe Ratio"
                      value={safeToFixed(backtestResults.sharpeRatio, 2)}
                      color="text-emerald-400"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Trades Panel */}
      {showTradesPanel && selectedStrategy && (
        <StrategyTradesPanel
          strategy={selectedStrategy}
          trades={strategyTrades}
          loading={loadingTrades}
          onClose={() => setShowTradesPanel(false)}
          onRefresh={() => loadStrategyTrades(selectedStrategy.id, true)}
        />
      )}

      {/* Properties Modal */}
      {showPropertiesModal && selectedProperties && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-4">
              <div>
                <h3 className="text-slate-100">Strategy Properties</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Complete list of properties from TradingView backtest
                </p>
              </div>
              <button
                onClick={() => {
                  setShowPropertiesModal(false);
                  setSelectedProperties(null);
                }}
                className="text-slate-400 transition-colors hover:text-slate-300"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="overflow-y-auto p-6" style={{ maxHeight: 'calc(80vh - 100px)' }}>
              <div className="space-y-3">
                {Object.entries(selectedProperties).map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <p className="text-sm text-slate-400 break-words">{key}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(String(value));
                          // Optional: Add a toast notification here
                        }}
                        className="flex-shrink-0 rounded-md bg-slate-700/50 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-slate-300 transition-colors"
                        title="Copy value"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="rounded-md bg-slate-900/50 p-3 font-mono text-xs text-slate-300 break-all whitespace-pre-wrap">
                      {String(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Closed Trades P/L View Component
interface ClosedTradesPLViewProps {
  trades: Trade[];
  timeRange: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'Custom';
  onTimeRangeChange: (range: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'Custom') => void;
}

function ClosedTradesPLView({ trades, timeRange, onTimeRangeChange }: ClosedTradesPLViewProps) {
  // Helper function to calculate time ranges
  const getTimeRangeDays = (range: string) => {
    switch (range) {
      case '1D': return 1;
      case '1W': return 7;
      case '1M': return 30;
      case '3M': return 90;
      case '6M': return 180;
      case '1Y': return 365;
      default: return 30;
    }
  };

  const filterTradesByTimeRange = (days: number) => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return trades.filter(t => new Date(getTradeSubmittedAt(t)) >= cutoffDate);
  };

  // Calculate metrics for the selected time range
  const filteredTrades = filterTradesByTimeRange(getTimeRangeDays(timeRange));
  const totalPL = filteredTrades.reduce((sum, t) => sum + (parseFloat(t.pnl as any) || 0), 0);
  const winningTrades = filteredTrades.filter(t => (parseFloat(t.pnl as any) || 0) > 0).length;
  const totalTrades = filteredTrades.length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  // Group trades by ticker and calculate P/L for different time ranges
  const tickerStats = trades.reduce((acc: any, trade) => {
    const symbol = trade.symbol;
    if (!acc[symbol]) {
      acc[symbol] = {
        symbol,
        trades: [],
      };
    }
    acc[symbol].trades.push(trade);
    return acc;
  }, {});

  const tickerData = Object.values(tickerStats).map((ticker: any) => {
    const allTrades = ticker.trades;
    const numTrades = allTrades.length;
    const wins = allTrades.filter((t: any) => (parseFloat(t.pnl as any) || 0) > 0).length;
    const winRate = numTrades > 0 ? (wins / numTrades) * 100 : 0;

    // Calculate P/L for different time ranges
    const calculatePL = (days: number) => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return allTrades
        .filter((t: any) => new Date(getTradeSubmittedAt(t)) >= cutoff)
        .reduce((sum: number, t: any) => sum + (parseFloat(t.pnl as any) || 0), 0);
    };

    return {
      symbol: ticker.symbol,
      numTrades,
      winRate,
      pl1D: calculatePL(1),
      pl1W: calculatePL(7),
      pl1M: calculatePL(30),
      pl1Q: calculatePL(90),
      pl6M: calculatePL(180),
      pl1Y: calculatePL(365),
      plTotal: allTrades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl as any) || 0), 0),
    };
  });

  const livePerformanceMetrics = calculateLiveMetricsFromTrades(
    trades,
    100000,
  );
  const accountEquity = 100000 + safeNumber(livePerformanceMetrics?.totalPnL);

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400">Time Range:</span>
        {(['1D', '1W', '1M', '3M', '6M', '1Y'] as const).map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              timeRange === range
                ? 'bg-blue-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {range}
          </button>
        ))}
        <button
          onClick={() => onTimeRangeChange('Custom')}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            timeRange === 'Custom'
              ? 'bg-blue-500 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          Custom
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
          <p className="mb-1 text-xs text-slate-500">Total Profit/Loss ({timeRange})</p>
          <p className={`text-3xl font-mono ${totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalPL >= 0 ? '+' : ''}${safeToFixed(totalPL, 2)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {totalPL >= 0 ? '+' : ''}{safeToFixed(accountEquity ? (totalPL / accountEquity) * 100 : 0, 2)}%
          </p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
          <p className="mb-1 text-xs text-slate-500">Win Rate</p>
          <p className="text-3xl font-mono text-blue-400">{safeToFixed(winRate, 1)}%</p>
          <p className="mt-1 text-xs text-slate-500">
            {winningTrades} wins / {totalTrades - winningTrades} losses
          </p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
          <p className="mb-1 text-xs text-slate-500">Account Equity</p>
          <p className="text-3xl font-mono text-slate-100">${safeToFixed(accountEquity, 2)}</p>
          <p className="mt-1 text-xs text-slate-500">Cash: ${safeToFixed(accountEquity * 0.82, 2)}</p>
        </div>
      </div>

      {/* Ticker Breakdown Table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Ticker</th>
                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase"># of Trades</th>
                <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Win Rate</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">1D P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">1W P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">1M P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">1Q P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">6M P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">1Y P/L</th>
                <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">Total P/L</th>
              </tr>
            </thead>
            <tbody>
              {tickerData.map((ticker: any) => (
                <tr key={ticker.symbol} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-blue-400 font-mono font-semibold">{ticker.symbol}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="text-sm text-slate-300 font-mono">{ticker.numTrades}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`text-sm font-mono ${ticker.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {ticker.safeToFixed(winRate, 1)}%
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl1D >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl1D !== 0 ? (ticker.pl1D >= 0 ? '+' : '') + safeToFixed(ticker.pl1D, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl1W >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl1W !== 0 ? (ticker.pl1W >= 0 ? '+' : '') + safeToFixed(ticker.pl1W, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl1M >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl1M !== 0 ? (ticker.pl1M >= 0 ? '+' : '') + safeToFixed(ticker.pl1M, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl1Q >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl1Q !== 0 ? (ticker.pl1Q >= 0 ? '+' : '') + safeToFixed(ticker.pl1Q, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl6M >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl6M !== 0 ? (ticker.pl6M >= 0 ? '+' : '') + safeToFixed(ticker.pl6M, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${ticker.pl1Y >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.pl1Y !== 0 ? (ticker.pl1Y >= 0 ? '+' : '') + safeToFixed(ticker.pl1Y, 2) : 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono font-semibold ${ticker.plTotal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {ticker.plTotal >= 0 ? '+' : ''}${safeToFixed(ticker.plTotal, 2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Strategy Trades Panel Component
interface StrategyTradesPanelProps {
  strategy: Strategy;
  trades: Trade[];
  loading: boolean;
  onClose: () => void;
  onRefresh?: () => Promise<void>;
}

function StrategyTradesPanel({ strategy, trades, loading, onClose, onRefresh }: StrategyTradesPanelProps) {
  const [activeTab, setActiveTab] = useState<'open' | 'closed' | 'closedPL' | 'pending' | 'performance'>('open');
  const [plTimeRange, setPlTimeRange] = useState<'1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'Custom'>('1M');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'entryTime', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const itemsPerPage = 20;

  // Filter trades based on active tab
  // Open Trades: Only BUY side orders that are filled (representing open positions)
  const openTrades = trades.filter(t => 
    t.side === 'buy' &&
    t.status === 'filled' && 
    !t.exitPrice &&
    !t.matchedSellId
  );
  
  // Closed Trades: Matched buy/sell pairs (only show the buy side with exitPrice)
  const closedTrades = trades.filter(t => 
    t.side === 'buy' &&
    t.exitPrice != null && 
    t.exitPrice !== undefined &&
    t.matchedSellId && // Must have a matched sell order
    t.status === 'filled'
  );
  
  // Pending Trades: Orders that are not yet filled or have errors/rejections
  // Only show rejected/error from last 24 hours (sync will auto-delete older ones)
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const pendingTrades = trades.filter(t => {
    // Active pending statuses
    if (['pending', 'accepted', 'new', 'partially_filled'].includes(t.status)) {
      return true;
    }
    // Rejected/error - only show recent ones
    if (['rejected', 'error', 'canceled', 'expired'].includes(t.status)) {
      // Check both submittedAt and timestamp fields
      const tradeDate = new Date(t.submittedAt || t.timestamp || 0);
      return tradeDate >= oneDayAgo;
    }
    return false;
  });

  // Calculate performance stats
  const totalPL = trades.reduce((sum, t) => sum + (parseFloat(t.pnl as any) || 0), 0);
  const winningTrades = trades.filter(t => t.pnl && parseFloat(t.pnl as any) > 0).length;
  const losingTrades = trades.filter(t => t.pnl && parseFloat(t.pnl as any) < 0).length;
  const totalTradesWithPL = trades.filter(t => t.pnl !== null && t.pnl !== undefined).length;
  const winRate = totalTradesWithPL > 0 ? (winningTrades / totalTradesWithPL * 100) : 0;
  const avgPL = totalTradesWithPL > 0 ? totalPL / totalTradesWithPL : 0;

  // Fetch current prices for open trades
  useEffect(() => {
    const fetchPrices = async () => {
      const symbols = [...new Set(openTrades.map(t => t.symbol))];
      if (symbols.length === 0) return;
      
      try {
        const response = await alpacaAPI.getQuotes(symbols);
        const priceMap: Record<string, number> = {};
        
        // Alpaca returns { quotes: { SYMBOL: { ap, bp, ... } } }
        if (response && response.quotes) {
          symbols.forEach((symbol) => {
            const quote = response.quotes[symbol];
            if (quote) {
              // Use ask price (ap) if available, otherwise bid price (bp)
              const price = quote.ap || quote.bp || 0;
              if (price > 0) {
                priceMap[symbol] = price;
              }
            }
          });
        }
        setCurrentPrices(priceMap);
      } catch (error) {
        console.error('Error fetching current prices:', error);
      }
    };
    
    if (activeTab === 'open' && openTrades.length > 0) {
      fetchPrices();
      // Refresh prices every 30 seconds
      const interval = setInterval(fetchPrices, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab, openTrades.length]);

  // Helper function to calculate holding time
  const calculateHoldingTime = (startDate: string) => {
    const now = new Date();
    const start = new Date(startDate);
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
  };

  // Helper function to calculate profit/loss for open trades
  const calculateOpenTradeProfit = (trade: Trade) => {
    const currentPrice = currentPrices[trade.symbol];
    if (!currentPrice || !trade.entryPrice) return null;
    
    const entryPrice = parseFloat(trade.entryPrice as any);
    const quantity = parseFloat(trade.quantity as any);
    const profitDollar = (currentPrice - entryPrice) * quantity;
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    return { profitDollar, profitPercent };
  };

  // Sorting function
  const getSortedTrades = (tradesToSort: Trade[]) => {
    return [...tradesToSort].sort((a, b) => {
      let aValue: any, bValue: any;

      switch (sortConfig.key) {
        case 'symbol':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'currentPrice':
          aValue = currentPrices[a.symbol] || 0;
          bValue = currentPrices[b.symbol] || 0;
          break;
        case 'entryPrice':
          aValue = parseFloat(a.entryPrice as any) || 0;
          bValue = parseFloat(b.entryPrice as any) || 0;
          break;
        case 'exitPrice':
          aValue = parseFloat(a.exitPrice as any) || 0;
          bValue = parseFloat(b.exitPrice as any) || 0;
          break;
        case 'quantity':
          aValue = a.quantity || 0;
          bValue = b.quantity || 0;
          break;
        case 'entryTime':
          aValue = new Date(a.submittedAt || 0).getTime();
          bValue = new Date(b.submittedAt || 0).getTime();
          break;
        case 'pnl':
          // For open trades, calculate real-time P/L
          if (activeTab === 'open') {
            const profitA = calculateOpenTradeProfit(a);
            const profitB = calculateOpenTradeProfit(b);
            aValue = profitA?.profitDollar || 0;
            bValue = profitB?.profitDollar || 0;
          } else {
            aValue = parseFloat(a.pnl as any) || 0;
            bValue = parseFloat(b.pnl as any) || 0;
          }
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) {
      return <ChevronsUpDownIcon />;
    }
    return sortConfig.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };

  // Get current trades based on active tab
  let currentTrades: Trade[] = [];
  if (activeTab === 'open') currentTrades = openTrades;
  else if (activeTab === 'closed') currentTrades = closedTrades;
  else if (activeTab === 'pending') currentTrades = pendingTrades;

  // Apply search filter
  const filteredTrades = searchQuery
    ? currentTrades.filter(trade => 
        trade.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : currentTrades;

  const sortedTrades = getSortedTrades(filteredTrades);
  const totalPages = Math.ceil(sortedTrades.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTrades = sortedTrades.slice(startIndex, startIndex + itemsPerPage);

  const [syncing, setSyncing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setSyncing(true);
    try {
      await onRefresh();
    } catch (error) {
      console.error('Error refreshing trades:', error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-7xl rounded-2xl border border-slate-700/50 bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={syncing}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-500/10 text-blue-400 rounded hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Refresh'}
          </button>
          <button
            onClick={onClose}
            className="text-slate-400 transition-colors hover:text-slate-300"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <h3 className="mb-2 text-slate-100">Strategy Trades - {strategy.name}</h3>
        <p className="mb-6 text-sm text-slate-400">
          All trades executed via TradingView webhooks for this strategy.
        </p>

        {/* Tabs */}
        <div className="border-b border-slate-700 mb-6">
          <div className="flex gap-8">
            <button
              onClick={() => {
                setActiveTab('open');
                setCurrentPage(1);
              }}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'open'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              OPEN TRADES ({openTrades.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('closed');
                setCurrentPage(1);
              }}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'closed'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              CLOSED TRADES ({closedTrades.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('closedPL');
                setCurrentPage(1);
              }}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'closedPL'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              CLOSED TRADES P/L
            </button>
            <button
              onClick={() => {
                setActiveTab('pending');
                setCurrentPage(1);
              }}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'pending'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              PENDING ORDERS ({pendingTrades.length})
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`pb-3 px-1 border-b-2 transition-colors ${
                activeTab === 'performance'
                  ? 'border-blue-500 text-blue-500'
                  : 'border-transparent text-slate-400 hover:text-slate-300'
              }`}
            >
              PERFORMANCE
            </button>
          </div>
        </div>

        {/* Content based on active tab */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-slate-400">Loading trades...</div>
          </div>
        ) : trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Activity className="w-16 h-16 mb-4 text-slate-600" />
            <p className="text-slate-400">No trades yet for this strategy.</p>
            <p className="text-xs text-slate-500 mt-2">
              Trades will appear here when TradingView sends alerts to your webhook URL.
            </p>
          </div>
        ) : activeTab === 'closedPL' ? (
          <ClosedTradesPLView trades={closedTrades} timeRange={plTimeRange} onTimeRangeChange={setPlTimeRange} />
        ) : activeTab === 'performance' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Total Trades</p>
                <p className="text-2xl font-mono text-slate-100">{winningTrades + losingTrades + openTrades.length}</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Total P/L</p>
                <p className={`text-2xl font-mono ${totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${safeToFixed(totalPL, 2)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Win Rate</p>
                <p className="text-2xl font-mono text-slate-100">{safeToFixed(winRate, 1)}%</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Avg P/L per Trade</p>
                <p className={`text-2xl font-mono ${avgPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${safeToFixed(avgPL, 2)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Winning Trades</p>
                <p className="text-2xl font-mono text-emerald-400">{winningTrades}</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Losing Trades</p>
                <p className="text-2xl font-mono text-rose-400">{losingTrades}</p>
              </div>
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-4">
                <p className="mb-1 text-xs text-slate-500">Open Positions</p>
                <p className="text-2xl font-mono text-blue-400">{openTrades.length}</p>
              </div>
            </div>
          </div>
        ) : currentTrades.length === 0 ? (
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
            No {activeTab} trades
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search Bar - only for Open, Closed, and Pending tabs */}
            {activeTab !== 'performance' && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by ticker..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full max-w-sm pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            )}

            <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      {activeTab === 'open' ? (
                        // Open Trades columns
                        <>
                          <th 
                            className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('symbol')}
                          >
                            <div className="flex items-center gap-1">
                              Ticker
                              <SortIcon columnKey="symbol" />
                            </div>
                          </th>
                          <th 
                            className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('currentPrice')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Current Price $
                              <SortIcon columnKey="currentPrice" />
                            </div>
                          </th>
                          <th 
                            className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('entryPrice')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Entry Price $
                              <SortIcon columnKey="entryPrice" />
                            </div>
                          </th>
                          <th 
                            className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('quantity')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              # of Shares
                              <SortIcon columnKey="quantity" />
                            </div>
                          </th>
                          <th 
                            className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('entryTime')}
                          >
                            <div className="flex items-center gap-1">
                              Entry Time
                              <SortIcon columnKey="entryTime" />
                            </div>
                          </th>
                          <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                            Holding Time
                          </th>
                          <th 
                            className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                            onClick={() => handleSort('pnl')}
                          >
                            <div className="flex items-center justify-end gap-1">
                              Profit $(%)
                              <SortIcon columnKey="pnl" />
                            </div>
                          </th>
                          <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                            Trading Account
                          </th>
                        </>
                      ) : (
                        // Closed/Pending trades columns
                        <>
                          {activeTab === 'closed' ? (
                            // Closed Trades columns matching the attached layout
                            <>
                              <th 
                                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('symbol')}
                              >
                                <div className="flex items-center gap-1">
                                  Ticker
                                  <SortIcon columnKey="symbol" />
                                </div>
                              </th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('entryPrice')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  Entry Price $
                                  <SortIcon columnKey="entryPrice" />
                                </div>
                              </th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('exitPrice')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  Exit Price $
                                  <SortIcon columnKey="exitPrice" />
                                </div>
                              </th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('quantity')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  # of Shares
                                  <SortIcon columnKey="quantity" />
                                </div>
                              </th>
                              <th 
                                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('entryTime')}
                              >
                                <div className="flex items-center gap-1">
                                  Entry Time
                                  <SortIcon columnKey="entryTime" />
                                </div>
                              </th>
                              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                                Exit Time
                              </th>
                              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                                Holding Time
                              </th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('pnl')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  Profit $(%)
                                  <SortIcon columnKey="pnl" />
                                </div>
                              </th>
                              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                                Trading Account
                              </th>
                            </>
                          ) : (
                            // Pending trades columns
                            <>
                              <th 
                                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('symbol')}
                              >
                                <div className="flex items-center gap-1">
                                  Symbol
                                  <SortIcon columnKey="symbol" />
                                </div>
                              </th>
                              <th 
                                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('entryTime')}
                              >
                                <div className="flex items-center gap-1">
                                  Entry Time
                                  <SortIcon columnKey="entryTime" />
                                </div>
                              </th>
                              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Side</th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('quantity')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  Quantity
                                  <SortIcon columnKey="quantity" />
                                </div>
                              </th>
                              <th 
                                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                                onClick={() => handleSort('entryPrice')}
                              >
                                <div className="flex items-center justify-end gap-1">
                                  Entry Price
                                  <SortIcon columnKey="entryPrice" />
                                </div>
                              </th>
                              <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Status</th>
                            </>
                          )}
                        </>
                      )}
                  </tr>
                </thead>
                  <tbody>
                    {paginatedTrades.map((trade) => {
                      const profit = activeTab === 'open' ? calculateOpenTradeProfit(trade) : null;
                      
                      return (
                        <tr key={trade.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                          {activeTab === 'open' ? (
                            // Open Trades row
                            <>
                              <td className="px-4 py-4">
                                <span className="text-sm text-blue-400 font-mono font-semibold">{trade.symbol}</span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-white font-mono">
                                  ${currentPrices[trade.symbol]?.toFixed(2) || '--'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-slate-300 font-mono">
                                  ${trade.entryPrice ? parseFloat(trade.entryPrice as any).toFixed(2) : '--'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-white font-mono">{trade.quantity || '--'}</span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="text-sm text-slate-300">
                                  {formatDate(trade.submittedAt)} {formatTime(trade.submittedAt)}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <span className="text-sm text-slate-300">
                                  {trade.submittedAt ? calculateHoldingTime(trade.submittedAt) : '0m'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                {profit ? (
                                  <div>
                                    <div className={`text-sm font-mono font-semibold ${profit.profitDollar >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {profit.profitDollar >= 0 ? '+' : ''}${safeToFixed(profit.profitDollar, 2)}
                                    </div>
                                    <div className={`text-xs font-mono ${profit.profitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {profit.profitPercent >= 0 ? '+' : ''}{safeToFixed(profit.profitPercent, 2)}%
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-500">--</span>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <span className="inline-block rounded bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                                  {trade.broker === 'alpaca' ? 'Alpaca Paper' : trade.broker || 'Unknown'}
                                </span>
                              </td>
                            </>
                          ) : activeTab === 'closed' ? (
                            // Closed Trades row - matching the attached layout
                            <>
                              <td className="px-4 py-4">
                                <span className="text-sm text-white font-mono font-semibold">{trade.symbol}</span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-slate-300 font-mono">
                                  ${trade.entryPrice ? parseFloat(trade.entryPrice as any).toFixed(2) : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className={`text-sm font-mono ${parseFloat(trade.exitPrice as any) > parseFloat(trade.entryPrice as any) ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  ${trade.exitPrice ? parseFloat(trade.exitPrice as any).toFixed(2) : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-white font-mono">{trade.quantity}</span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="text-sm text-slate-300">
                                  {formatDate(trade.submittedAt)} {formatTime(trade.submittedAt)}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="text-sm text-slate-300">
                                  {trade.closedAt ? formatDate(trade.closedAt) + ' ' + formatTime(trade.closedAt) : '-'}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <span className="text-sm text-slate-300">
                                  {trade.closedAt && trade.submittedAt ? calculateHoldingTime(trade.submittedAt, trade.closedAt) : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                {trade.pnl !== null && trade.pnl !== undefined ? (
                                  <div>
                                    <div className={`text-sm font-mono font-semibold ${parseFloat(trade.pnl as any) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {parseFloat(trade.pnl as any) >= 0 ? '+' : ''}${parseFloat(trade.pnl as any).toFixed(2)}
                                    </div>
                                    <div className={`text-xs font-mono ${parseFloat(trade.pnl as any) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {parseFloat(trade.pnl as any) >= 0 ? '+' : ''}{((parseFloat(trade.pnl as any) / (parseFloat(trade.entryPrice as any) * trade.quantity)) * 100).toFixed(2)}%
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-500">-</span>
                                )}
                              </td>
                              <td className="px-4 py-4">
                                <span className="inline-block rounded bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
                                  {trade.broker === 'alpaca' ? 'Alpaca Paper' : trade.broker || 'Unknown'}
                                </span>
                              </td>
                            </>
                          ) : (
                            // Pending Trades row
                            <>
                              <td className="px-4 py-4">
                                <span className="text-sm text-blue-400 font-mono font-semibold">{trade.symbol}</span>
                              </td>
                              <td className="px-4 py-4">
                                <div className="text-sm text-slate-300">
                                  {formatDate(trade.submittedAt)} {formatTime(trade.submittedAt)}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <span
                                  className={`inline-block rounded px-2 py-1 text-xs ${
                                    trade.side === 'buy'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : 'bg-rose-500/10 text-rose-400'
                                  }`}
                                >
                                  {trade.side.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-white font-mono">{trade.quantity}</span>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className="text-sm text-slate-300 font-mono">
                                  {trade.entryPrice ? `$${parseFloat(trade.entryPrice as any).toFixed(2)}` : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-center">
                                <span
                                  className={`inline-block rounded px-2 py-1 text-xs ${
                                    trade.status === 'filled'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : trade.status === 'rejected' || trade.status === 'error'
                                      ? 'bg-rose-500/10 text-rose-400'
                                      : trade.status === 'pending' || trade.status === 'accepted'
                                      ? 'bg-yellow-500/10 text-yellow-400'
                                      : 'bg-slate-800 text-slate-400'
                                  }`}
                                >
                                  {trade.status}
                                </span>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 px-4 py-4 bg-slate-900/30 border-t border-slate-700">
                <button
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1.5 text-sm rounded transition-colors ${
                        pageNum === currentPage
                          ? 'bg-blue-500 text-white border border-blue-500'
                          : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                
                <button
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MetricRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

function MetricRow({ icon, label, value, color }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className={`font-mono text-sm ${color}`}>{value}</span>
    </div>
  );
}

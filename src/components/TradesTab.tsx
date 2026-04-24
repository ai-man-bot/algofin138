import { useState, useEffect } from 'react';
import { alpacaAPI, brokersAPI, webhooksAPI } from '../utils/api';
import { NewOpenTradesTable, OrdersTable } from './NewTables';
import { calculatePerformanceMetricsFromPairs, createTradingPairs } from '../utils/tradeAnalytics';

// Custom Icons
const SearchIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <circle cx="11" cy="11" r="8" strokeWidth="2" />
    <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="7 10 12 15 17 10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="12" y1="15" x2="12" y2="3" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

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

// Pagination Component
function Pagination({ currentPage, totalPages, onPageChange }: { currentPage: number, totalPages: number, onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const maxPagesToShow = 5;

  if (totalPages <= maxPagesToShow) {
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    if (currentPage <= 3) {
      pages.push(1, 2, 3, 4, 5);
    } else if (currentPage >= totalPages - 2) {
      for (let i = totalPages - 4; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      for (let i = currentPage - 2; i <= currentPage + 2; i++) {
        pages.push(i);
      }
    }
  }

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-4 bg-slate-900/30 border-t border-slate-700">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Previous
      </button>
      
      {pages.map(page => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            page === currentPage
              ? 'bg-blue-500 text-white border border-blue-500'
              : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
          }`}
        >
          {page}
        </button>
      ))}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  );
}

// Utility functions
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

interface TradesTabProps {
  selectedBrokerId: string;
  setSelectedBrokerId: (id: string) => void;
}

export function TradesTab({ selectedBrokerId, setSelectedBrokerId }: TradesTabProps) {
  const [activeTab, setActiveTab] = useState<'webhooks' | 'open' | 'orders' | 'closed' | 'pending' | 'pl' | 'performance'>('webhooks');
  const [positions, setPositions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [alpacaConnected, setAlpacaConnected] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [backfilling, setBackfilling] = useState(false);
  const [connectedBrokers, setConnectedBrokers] = useState<any[]>([]);

  useEffect(() => {
    loadData();
    // Refresh quotes every 10 seconds for open positions
    const interval = setInterval(() => {
      if (activeTab === 'open' && positions.length > 0) {
        refreshQuotes();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [activeTab, selectedBrokerId]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load connected brokers
      const brokers = await brokersAPI.getAll();
      console.log('📊 TradesTab: Loaded brokers:', brokers);
      setConnectedBrokers(brokers || []);
      
      // Helper function to check if a broker is an Alpaca account
      const isAlpacaBroker = (broker: any) => {
        return broker.brokerType === 'alpaca' || broker.id === 'alpaca' || (typeof broker.id === 'string' && broker.id.startsWith('alpaca:'));
      };
      
      // Filter Alpaca brokers
      const alpacaBrokers = brokers.filter((b: any) => isAlpacaBroker(b) && b.connected);
      
      console.log('📊 TradesTab: Found Alpaca brokers:', alpacaBrokers.length);
      
      // Set alpacaConnected based on whether we have ANY connected Alpaca brokers
      if (alpacaBrokers.length > 0) {
        setAlpacaConnected(true);
      } else {
        setAlpacaConnected(false);
        setLoading(false);
        return;
      }
      
      // If no broker is selected and we have Alpaca brokers, select the first one
      if (!selectedBrokerId && alpacaBrokers.length > 0) {
        setSelectedBrokerId(alpacaBrokers[0].id);
        return; // Will trigger re-render with selected broker
      }
      
      // Fetch webhook events
      let webhookEventsData = [];
      try {
        const eventsData = await webhooksAPI.getEvents('all');
        webhookEventsData = Array.isArray(eventsData) ? eventsData : [];
        console.log('Loaded webhook events:', webhookEventsData.length);
        console.log('Event data:', webhookEventsData);
      } catch (error) {
        console.error('Error loading webhook events:', error);
      }
      console.log('TradesTab: Loaded webhook events:', webhookEventsData.length);
      console.log('TradesTab: First few events:', webhookEventsData.slice(0, 3));
      setWebhookEvents(webhookEventsData);
      
      // Find the selected broker
      const selectedBroker = alpacaBrokers.find((b: any) => b.id === selectedBrokerId);
      
      if (selectedBroker) {
        // Fetch positions and orders from Alpaca for the selected broker
        console.log(`📊 TradesTab: Fetching data for broker ${selectedBrokerId}`);
        const [positionsData, ordersData] = await Promise.all([
          alpacaAPI.getPositions(selectedBrokerId),
          alpacaAPI.getOrders(selectedBrokerId, 'all', 500),
        ]);
        
        if (positionsData.error || ordersData.error) {
          setAlpacaConnected(false);
          setPositions([]);
          setOrders([]);
        } else {
          setAlpacaConnected(true);
          
          console.log('📊 Alpaca Data loaded:');
          console.log('  - Positions:', positionsData.length);
          console.log('  - Orders:', ordersData.length);
          
          setPositions(positionsData);
          setOrders(ordersData);
          
          // Fetch quotes for all unique symbols
          const symbols = Array.from(new Set([
            ...positionsData.map((p: any) => p.symbol),
            ...ordersData.map((o: any) => o.symbol)
          ]));
          
          if (symbols.length > 0) {
            const quotesData = await alpacaAPI.getQuotes(symbols);
            setQuotes(quotesData.quotes || {});
          }
        }
      } else {
        setAlpacaConnected(false);
        setPositions([]);
        setOrders([]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setAlpacaConnected(false);
    } finally {
      setLoading(false);
    }
  };

  const refreshQuotes = async () => {
    try {
      const symbols = positions.map(p => p.symbol);
      if (symbols.length > 0) {
        const quotesData = await alpacaAPI.getQuotes(symbols);
        setQuotes(quotesData.quotes || {});
      }
    } catch (error) {
      console.error('Error refreshing quotes:', error);
    }
  };

  // Filter data
  const filteredPositions = positions.filter(p => 
    p.symbol?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const filteredWebhookEvents = webhookEvents.filter(e =>
    e.payload?.symbol?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.webhookName?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const closedTrades = orders.filter(o => 
    o.status === 'filled' && 
    o.symbol?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const pendingOrders = orders.filter(o => 
    ['pending_new', 'new', 'accepted', 'pending_cancel', 'pending_replace'].includes(o.status) &&
    o.symbol?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  // Open trades are just the filtered positions (no entry time - positions don't have that)
  const openTrades = filteredPositions;
  
  // Debug logging
  console.log('📊 TradesTab Data Summary:');
  console.log('  - Webhook Events:', webhookEvents.length);
  console.log('  - Alpaca Positions (Open Trades):', positions.length);
  console.log('  - Alpaca Orders (All):', orders.length);
  console.log('  - Closed Trades:', closedTrades.length);
  console.log('  - Pending Orders:', pendingOrders.length);

  // Calculate P/L statistics
  const calculatePLStats = () => {
    let totalProfitLoss = 0;
    let totalCostBasis = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    
    // From open positions
    positions.forEach(pos => {
      const unrealizedPL = parseFloat(pos.unrealized_pl || 0);
      totalCostBasis += Math.abs(parseFloat(pos.cost_basis || 0));
      totalProfitLoss += unrealizedPL;
      if (unrealizedPL > 0) winningTrades++;
      else if (unrealizedPL < 0) losingTrades++;
    });
    
    // From closed trades (would need to calculate from activities)
    // For now, using unrealized P/L from open positions
    
    const totalTrades = winningTrades + losingTrades;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100).toFixed(1) : '0.0';
    const rawProfitPercent = totalCostBasis > 0 ? (totalProfitLoss / totalCostBasis) * 100 : 0;
    const profitPercent = `${rawProfitPercent >= 0 ? '+' : ''}${rawProfitPercent.toFixed(2)}`;
    
    return {
      totalProfitLoss,
      winRate,
      profitPercent,
      winningTrades,
      losingTrades,
    };
  };

  const plStats = calculatePLStats();

  // Export functions
  const exportOpenTrades = () => {
    const headers = ['Asset', 'Price', 'Qty', 'Side', 'Market Value', 'Avg Entry', 'Cost Basis', 'Today\'s P/L (%)', 'Today\'s P/L ($)', 'Total P/L (%)', 'Total P/L ($)'];
    const rows = openTrades.map(pos => {
      const currentPrice = quotes[pos.symbol]?.ap || parseFloat(pos.current_price || 0);
      const qty = parseFloat(pos.qty || 0);
      const side = qty >= 0 ? 'Long' : 'Short';
      const marketValue = parseFloat(pos.market_value || 0);
      const avgEntry = parseFloat(pos.avg_entry_price || 0);
      const costBasis = parseFloat(pos.cost_basis || 0);
      
      const todayPL = parseFloat(pos.unrealized_intraday_pl || 0);
      const todayPLPercent = parseFloat(pos.unrealized_intraday_plpc || 0) * 100;
      
      const unrealizedPL = parseFloat(pos.unrealized_pl || 0);
      const unrealizedPLPercent = parseFloat(pos.unrealized_plpc || 0) * 100;
      
      return [
        pos.symbol,
        currentPrice.toFixed(2),
        Math.abs(qty).toFixed(2),
        side,
        marketValue.toFixed(2),
        avgEntry.toFixed(4),
        costBasis.toFixed(2),
        (todayPL >= 0 ? '+' : '') + todayPLPercent.toFixed(2) + '%',
        '$' + (todayPL >= 0 ? '+' : '') + todayPL.toFixed(2),
        (unrealizedPL >= 0 ? '+' : '') + unrealizedPLPercent.toFixed(2) + '%',
        '$' + (unrealizedPL >= 0 ? '+' : '') + unrealizedPL.toFixed(2)
      ];
    });
    
    downloadCSV('open_positions', headers, rows);
  };

  const exportClosedTrades = () => {
    // Create trading pairs for export
    const pairs: any[] = [];
    const filledOrders = closedTrades;
    
    // Group orders by symbol
    const ordersBySymbol = new Map<string, any[]>();
    filledOrders.forEach(order => {
      const symbol = order.symbol;
      if (!ordersBySymbol.has(symbol)) {
        ordersBySymbol.set(symbol, []);
      }
      ordersBySymbol.get(symbol)!.push(order);
    });
    
    // For each symbol, match buy/sell pairs
    ordersBySymbol.forEach((orders, symbol) => {
      const sortedOrders = orders.sort((a, b) => {
        const timeA = new Date(a.filled_at || a.updated_at || a.created_at).getTime();
        const timeB = new Date(b.filled_at || b.updated_at || b.created_at).getTime();
        return timeA - timeB;
      });
      
      // Process orders sequentially to match entry/exit pairs
      for (let i = 0; i < sortedOrders.length - 1; i++) {
        const firstOrder = sortedOrders[i];
        const secondOrder = sortedOrders[i + 1];
        
        // Only pair if they are opposite sides
        if (firstOrder.side !== secondOrder.side) {
          const firstQty = parseFloat(firstOrder.filled_qty || firstOrder.qty || 0);
          const secondQty = parseFloat(secondOrder.filled_qty || secondOrder.qty || 0);
          const firstPrice = parseFloat(firstOrder.filled_avg_price || 0);
          const secondPrice = parseFloat(secondOrder.filled_avg_price || 0);
          const firstTime = firstOrder.filled_at || firstOrder.updated_at || firstOrder.created_at;
          const secondTime = secondOrder.filled_at || secondOrder.updated_at || secondOrder.created_at;
          
          const matchedQty = Math.min(firstQty, secondQty);
          
          // FIXED: Keep chronological order for times, use BUY/SELL for price calculation
          let entryPrice, exitPrice, profitDollar, profitPercent;
          let buyPrice, sellPrice;
          
          if (firstOrder.side === 'buy') {
            buyPrice = firstPrice;
            sellPrice = secondPrice;
          } else {
            buyPrice = secondPrice;
            sellPrice = firstPrice;
          }
          
          // For LONG trades: Entry = BUY price, Exit = SELL price
          entryPrice = buyPrice;
          exitPrice = sellPrice;
          profitDollar = (exitPrice - entryPrice) * matchedQty;
          profitPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
          
          // Times are always chronological
          const entryTime = firstTime;
          const exitTime = secondTime;
          
          pairs.push({
            symbol: symbol,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            shares: matchedQty,
            entryTime: entryTime,
            exitTime: exitTime,
            profitDollar: profitDollar,
            profitPercent: profitPercent,
          });
          
          i++;
        }
      }
    });
    
    const headers = ['Ticker', 'Entry Price', 'Exit Price', '# of Shares', 'Entry Time', 'Exit Time', 'Holding Time', 'Profit %', 'Profit $', 'Trading Account'];
    const rows = pairs.map(pair => {
      return [
        pair.symbol,
        pair.entryPrice.toFixed(2),
        pair.exitPrice.toFixed(2),
        pair.shares.toFixed(2),
        new Date(pair.entryTime || '').toLocaleString(),
        new Date(pair.exitTime || '').toLocaleString(),
        calculateHoldingTime(pair.entryTime || '', pair.exitTime),
        (pair.profitPercent >= 0 ? '+' : '') + pair.profitPercent.toFixed(2) + '%',
        '$' + (pair.profitDollar >= 0 ? '+' : '') + pair.profitDollar.toFixed(2),
        'Alpaca Paper'
      ];
    });
    
    downloadCSV('closed_trades', headers, rows);
  };

  const exportPendingOrders = () => {
    const headers = ['Ticker', 'Current Price', 'Order Price', 'Order Time', 'Order Status', '# of Shares'];
    const rows = pendingOrders.map(order => {
      const currentPrice = quotes[order.symbol]?.ap || 0;
      const orderPrice = parseFloat(order.limit_price || order.stop_price || 0);
      
      return [
        order.symbol,
        currentPrice.toFixed(2),
        orderPrice > 0 ? orderPrice.toFixed(2) : 'Market',
        new Date(order.created_at || '').toLocaleString(),
        order.status,
        order.qty
      ];
    });
    
    downloadCSV('pending_orders', headers, rows);
  };

  const exportOrders = () => {
    const headers = ['Asset', 'Order Type', 'Side', 'Qty', 'Avg. Fill Price', 'Total Amount', 'Submitted At', 'Filled At', 'Status'];
    const rows = orders.map(order => {
      const qty = parseFloat(order.filled_qty || order.qty || 0);
      const fillPrice = parseFloat(order.filled_avg_price || order.limit_price || 0);
      const totalAmount = qty * fillPrice;
      
      return [
        order.symbol,
        order.type || order.order_type || 'market',
        order.side,
        qty.toFixed(2),
        fillPrice > 0 ? fillPrice.toFixed(2) : '-',
        totalAmount > 0 ? totalAmount.toFixed(2) : '-',
        order.submitted_at ? new Date(order.submitted_at).toLocaleString() : '-',
        order.filled_at ? new Date(order.filled_at).toLocaleString() : '-',
        order.status
      ];
    });
    
    downloadCSV('orders', headers, rows);
  };

  const downloadCSV = (filename: string, headers: string[], rows: any[][]) => {
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const backfillWebhookEvents = async () => {
    try {
      setBackfilling(true);
      const result = await webhooksAPI.backfillEvents();
      console.log('Backfill result:', result);
      // Reload data to show new webhook events
      await loadData();
      alert(`Backfill complete: ${result.message || 'Done'}`);
    } catch (error) {
      console.error('Error backfilling:', error);
      alert('Error during backfill');
    } finally {
      setBackfilling(false);
    }
  };

  if (!alpacaConnected) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center max-w-md">
            <div className="mb-4 text-slate-400">
              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl text-white mb-2">No Broker Connected</h3>
            <p className="text-slate-400 mb-6">
              Connect your Alpaca broker account to see your trades.
            </p>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '#brokers';
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Connect Broker
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Helper function to check if a broker is an Alpaca account
  const isAlpacaBroker = (broker: any) => {
    return broker.brokerType === 'alpaca' || broker.id === 'alpaca' || (typeof broker.id === 'string' && broker.id.startsWith('alpaca:'));
  };

  return (
    <div className="min-h-screen bg-[#0f172a] p-6 space-y-6">
      {/* Broker Account Selector */}
      {connectedBrokers.filter((b: any) => isAlpacaBroker(b)).length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🦙</div>
            <div>
              <h4 className="text-sm text-slate-300">Viewing Account</h4>
              <p className="text-xs text-slate-500">Select an account to display trades</p>
            </div>
          </div>
          <select
            value={selectedBrokerId}
            onChange={(e) => setSelectedBrokerId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-white outline-none transition-colors focus:border-blue-500"
          >
            {connectedBrokers
              .filter((b: any) => isAlpacaBroker(b))
              .map((broker: any) => (
                <option key={broker.id} value={broker.id}>
                  {broker.name} - {broker.accountId}
                </option>
              ))}
          </select>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white mb-1">Trades & Webhooks</h2>
          <p className="text-sm text-slate-400">
            Monitor TradingView webhook signals and Alpaca trade execution
            {webhookEvents.length > 0 && (
              <span className="ml-2 text-blue-400">({webhookEvents.length} webhook events)</span>
            )}
          </p>
        </div>
        <div className="flex gap-3">
          {activeTab === 'webhooks' && webhookEvents.length === 0 && (
            <button
              onClick={backfillWebhookEvents}
              disabled={backfilling}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Create webhook events from existing strategy trades"
            >
              {backfilling ? (
                <>
                  <RefreshIcon />
                  Backfilling...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4 v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Backfill Events
                </>
              )}
            </button>
          )}
          <button
            onClick={loadData}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-colors flex items-center gap-2"
          >
            <RefreshIcon />
            Refresh
          </button>
          <button
            onClick={() => {
              if (activeTab === 'open') exportOpenTrades();
              else if (activeTab === 'orders') exportOrders();
              else if (activeTab === 'closed') exportClosedTrades();
              else if (activeTab === 'pending') exportPendingOrders();
            }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <DownloadIcon />
            Export CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-700">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'webhooks'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            WEBHOOK LOGS ({filteredWebhookEvents.length})
          </button>
          <button
            onClick={() => setActiveTab('open')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'open'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            OPEN TRADES ({openTrades.length})
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'orders'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            ORDERS ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('closed')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'closed'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            CLOSED TRADES
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'pending'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            PENDING ORDERS
          </button>
          <button
            onClick={() => setActiveTab('pl')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'pl'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            P/L ANALYSIS
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`pb-3 px-1 border-b-2 transition-colors ${
              activeTab === 'performance'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-slate-400 hover:text-slate-300'
            }`}
          >
            PERFORMANCE
          </button>
        </div>
      </div>

      {/* Search */}
      {activeTab !== 'pl' && activeTab !== 'performance' && (
        <div className="relative w-64">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search by ticker..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'webhooks' && (
        <WebhookLogsTable events={filteredWebhookEvents} />
      )}
      
      {activeTab === 'open' && (
        <NewOpenTradesTable trades={openTrades} quotes={quotes} />
      )}
      
      {activeTab === 'orders' && (
        <OrdersTable orders={orders} />
      )}
      
      {activeTab === 'closed' && (
        <ClosedTradesTable trades={closedTrades} />
      )}
      
      {activeTab === 'pending' && (
        <PendingOrdersTable orders={pendingOrders} quotes={quotes} />
      )}
      
      {activeTab === 'pl' && (
        <ClosedPLPanel stats={plStats} brokerId={selectedBrokerId} />
      )}
      
      {activeTab === 'performance' && (
        <PerformancePanel orders={orders} />
      )}
    </div>
  );
}

// Webhook Logs Table
function WebhookLogsTable({ events }: { events: any[] }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const itemsPerPage = 20;

  const getSortedEvents = () => {
    if (!sortConfig) return events;
    
    return [...events].sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      if (sortConfig.key === 'timestamp') {
        aValue = new Date(a.receivedAt || a.timestamp).getTime();
        bValue = new Date(b.receivedAt || b.timestamp).getTime();
      } else if (sortConfig.key === 'symbol') {
        aValue = a.payload?.symbol || '';
        bValue = b.payload?.symbol || '';
      } else if (sortConfig.key === 'action') {
        aValue = a.payload?.action || '';
        bValue = b.payload?.action || '';
      } else if (sortConfig.key === 'quantity') {
        aValue = parseFloat(a.payload?.quantity || 0);
        bValue = parseFloat(b.payload?.quantity || 0);
      } else if (sortConfig.key === 'status') {
        aValue = a.status || '';
        bValue = b.status || '';
      } else {
        aValue = a[sortConfig.key];
        bValue = b[sortConfig.key];
      }
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ChevronsUpDownIcon />;
    }
    return sortConfig.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };

  const sortedEvents = getSortedEvents();
  const totalPages = Math.ceil(sortedEvents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedEvents = sortedEvents.slice(startIndex, startIndex + itemsPerPage);

  if (events.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
        <div className="text-slate-400 mb-2">No webhook events received yet</div>
        <div className="text-sm text-slate-500">
          Webhook signals from TradingView will appear here once configured
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('timestamp')}
              >
                <div className="flex items-center gap-1">
                  Timestamp
                  <SortIcon columnKey="timestamp" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                Webhook Name
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('action')}
              >
                <div className="flex items-center gap-1">
                  Action
                  <SortIcon columnKey="action" />
                </div>
              </th>
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
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('quantity')}
              >
                <div className="flex items-center justify-end gap-1">
                  Quantity
                  <SortIcon columnKey="quantity" />
                </div>
              </th>
              <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase">
                Price
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                Order Type
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Status
                  <SortIcon columnKey="status" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                Notes
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">
                Payload
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedEvents.map((event) => {
              const payload = event.payload || {};
              const isExpanded = expandedRow === event.id;
              
              // Debug: log event data to console for troubleshooting
              if (event.status === 'error' && (!event.error && !event.reason)) {
                console.log('⚠️ Event with error status but no error/reason field:', event);
              }
              
              return (
                <>
                  <tr key={event.id} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="text-sm text-slate-300">
                        {formatDate(event.receivedAt || event.timestamp || '')} {formatTime(event.receivedAt || event.timestamp || '')}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-sm text-white">{event.webhookName || 'Unknown'}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono font-semibold ${
                        payload.action === 'buy' || payload.action === 'BUY'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : payload.action === 'sell' || payload.action === 'SELL'
                          ? 'bg-rose-500/20 text-rose-400'
                          : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        {(payload.action || 'UNKNOWN').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-sm text-blue-400 font-mono font-semibold">
                        {payload.symbol || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="text-sm text-white font-mono">
                        {payload.quantity || 0}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="text-sm text-slate-300 font-mono">
                        {payload.price ? `$${parseFloat(payload.price).toFixed(2)}` : 'Market'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-sm text-slate-300 font-mono">
                        {payload.orderType || 'market'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${
                        event.status === 'processed' || event.status === 'filled'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : event.status === 'error' || event.status === 'rejected'
                          ? 'bg-rose-500/20 text-rose-400'
                          : event.status === 'blocked'
                          ? 'bg-orange-500/20 text-orange-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {event.status || 'pending'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {(event.error || event.reason || event.execution?.error) ? (
                        <div className="text-xs text-slate-300 max-w-xs">
                          {event.error || event.reason || event.execution?.error || 'Unknown error'}
                        </div>
                      ) : event.status === 'error' ? (
                        <div className="text-xs text-orange-400">
                          <div>Error occurred - check details below</div>
                          {event.alpacaError && (
                            <div className="mt-1 text-rose-400">
                              {event.alpacaError.message || event.alpacaError.error || JSON.stringify(event.alpacaError)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => setExpandedRow(isExpanded ? null : event.id)}
                        className="text-blue-400 hover:text-blue-300 text-xs underline"
                      >
                        {isExpanded ? 'Hide' : 'View JSON'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${event.id}-expanded`} className="border-b border-slate-700/50 bg-slate-900/50">
                      <td colSpan={10} className="px-4 py-4">
                        <div className="text-xs space-y-4">
                          <div>
                            <div className="text-slate-400 mb-2 font-semibold">Full Event Data:</div>
                            <pre className="bg-slate-950 p-3 rounded border border-slate-700 overflow-x-auto text-slate-300 font-mono text-xs">
                              {JSON.stringify(event, null, 2)}
                            </pre>
                          </div>
                          {payload && (
                            <div>
                              <div className="text-slate-400 mb-2 font-semibold">Raw Payload:</div>
                              <pre className="bg-slate-950 p-3 rounded border border-slate-700 overflow-x-auto text-slate-300 font-mono text-xs">
                                {JSON.stringify(payload.rawPayload || payload, null, 2)}
                              </pre>
                            </div>
                          )}
                          {event.alpacaError && (
                            <div>
                              <div className="text-rose-400 mb-2 font-semibold">Alpaca Error Response:</div>
                              <pre className="bg-slate-950 p-3 rounded border border-rose-900/30 overflow-x-auto text-rose-300 font-mono text-xs">
                                {JSON.stringify(event.alpacaError, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

// Open Trades Table
function OpenTradesTable({ trades, quotes }: { trades: any[], quotes: Record<string, any> }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'entryTime', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  if (trades.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
        No open positions
      </div>
    );
  }

  // Sorting function
  const getSortedTrades = () => {
    if (!sortConfig) return trades;

    return [...trades].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'ticker':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'currentPrice':
          aValue = quotes[a.symbol]?.ap || parseFloat(a.current_price || 0);
          bValue = quotes[b.symbol]?.ap || parseFloat(b.current_price || 0);
          break;
        case 'entryPrice':
          aValue = parseFloat(a.avg_entry_price || 0);
          bValue = parseFloat(b.avg_entry_price || 0);
          break;
        case 'shares':
          aValue = parseFloat(a.qty || 0);
          bValue = parseFloat(b.qty || 0);
          break;
        case 'entryTime':
          aValue = new Date(a.created_at || 0).getTime();
          bValue = new Date(b.created_at || 0).getTime();
          break;
        case 'profit':
          aValue = parseFloat(a.unrealized_pl || 0);
          bValue = parseFloat(b.unrealized_pl || 0);
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
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1); // Reset to first page when sorting
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ChevronsUpDownIcon />;
    }
    return sortConfig.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };

  const sortedTrades = getSortedTrades();
  const totalPages = Math.ceil(sortedTrades.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTrades = sortedTrades.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('ticker')}
              >
                <div className="flex items-center gap-1">
                  Ticker
                  <SortIcon columnKey="ticker" />
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
                onClick={() => handleSort('shares')}
              >
                <div className="flex items-center justify-end gap-1">
                  # of Shares
                  <SortIcon columnKey="shares" />
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
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Holding Time</th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('profit')}
              >
                <div className="flex items-center justify-end gap-1">
                  Profit $/(%
)
                  <SortIcon columnKey="profit" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Trading Account</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((trade, idx) => {
              const currentPrice = quotes[trade.symbol]?.ap || parseFloat(trade.current_price || 0);
              const entryPrice = parseFloat(trade.avg_entry_price || 0);
              const shares = parseFloat(trade.qty || 0);
              const profitDollar = parseFloat(trade.unrealized_pl || 0);
              const profitPercent = parseFloat(trade.unrealized_plpc || 0) * 100;
              
              return (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-blue-400 font-mono font-semibold cursor-pointer underline">
                      {trade.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">${currentPrice.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-slate-300 font-mono">${entryPrice.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">{shares.toFixed(0)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDate(trade.created_at || '')} {formatTime(trade.created_at || '')}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-sm text-slate-300">
                      {calculateHoldingTime(trade.created_at || new Date().toISOString())}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono font-semibold ${profitDollar >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${profitDollar.toFixed(2)}
                    </div>
                    <div className={`text-xs font-mono ${profitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {profitPercent >= 0 ? '+' : ''}{profitPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
                      Alpaca Paper
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

// Closed Trades Table
function ClosedTradesTable({ trades }: { trades: any[] }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'entryTime', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Match buy and sell orders to create trading pairs
  const createTradingPairs = () => {
    const pairs: any[] = [];
    const filledOrders = trades.filter(t => t.status === 'filled');
    
    // Group orders by symbol
    const ordersBySymbol = new Map<string, any[]>();
    filledOrders.forEach(order => {
      const symbol = order.symbol;
      if (!ordersBySymbol.has(symbol)) {
        ordersBySymbol.set(symbol, []);
      }
      ordersBySymbol.get(symbol)!.push(order);
    });
    
    // For each symbol, match buy/sell pairs
    ordersBySymbol.forEach((orders, symbol) => {
      // Sort by filled_at time
      const sortedOrders = orders.sort((a, b) => {
        const timeA = new Date(a.filled_at || a.updated_at || a.created_at).getTime();
        const timeB = new Date(b.filled_at || b.updated_at || b.created_at).getTime();
        return timeA - timeB;
      });
      
      // Process orders sequentially to match entry/exit pairs
      for (let i = 0; i < sortedOrders.length - 1; i++) {
        const firstOrder = sortedOrders[i];
        const secondOrder = sortedOrders[i + 1];
        
        // Only pair if they are opposite sides (buy/sell or sell/buy)
        if (firstOrder.side !== secondOrder.side) {
          const firstQty = parseFloat(firstOrder.filled_qty || firstOrder.qty || 0);
          const secondQty = parseFloat(secondOrder.filled_qty || secondOrder.qty || 0);
          const firstPrice = parseFloat(firstOrder.filled_avg_price || 0);
          const secondPrice = parseFloat(secondOrder.filled_avg_price || 0);
          const firstTime = firstOrder.filled_at || firstOrder.updated_at || firstOrder.created_at;
          const secondTime = secondOrder.filled_at || secondOrder.updated_at || secondOrder.created_at;
          
          // Calculate matched quantity
          const matchedQty = Math.min(firstQty, secondQty);
          
          // FIXED: Keep chronological order for times, but use BUY/SELL for prices and profit
          // Entry time is ALWAYS the earlier time, Exit time is ALWAYS the later time
          // But Entry price = BUY price, Exit price = SELL price (for LONG trades)
          let entryPrice, exitPrice, profitDollar, profitPercent;
          let buyPrice, sellPrice;
          
          // Determine which price is BUY and which is SELL
          if (firstOrder.side === 'buy') {
            buyPrice = firstPrice;
            sellPrice = secondPrice;
          } else {
            buyPrice = secondPrice;
            sellPrice = firstPrice;
          }
          
          // For LONG trades: Entry = BUY price, Exit = SELL price
          entryPrice = buyPrice;
          exitPrice = sellPrice;
          profitDollar = (exitPrice - entryPrice) * matchedQty;
          profitPercent = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
          
          // Times are always chronological (first = entry, second = exit)
          const entryTime = firstTime;
          const exitTime = secondTime;
          
          // Debug logging
          console.log(`LONG ${symbol}: Entry=$${entryPrice.toFixed(2)} (${new Date(entryTime).toLocaleString()}), Exit=$${exitPrice.toFixed(2)} (${new Date(exitTime).toLocaleString()}), Qty=${matchedQty}, Profit=$${profitDollar.toFixed(2)}`);
          
          pairs.push({
            symbol: symbol,
            entryPrice: entryPrice,
            exitPrice: exitPrice,
            shares: matchedQty,
            entryTime: entryTime,
            exitTime: exitTime,
            profitDollar: profitDollar,
            profitPercent: profitPercent,
            side: 'LONG',
          });
          
          // Skip the second order since we've paired it
          i++;
        }
      }
    });
    
    return pairs;
  };

  const tradingPairs = createTradingPairs();

  if (tradingPairs.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
        No closed trade pairs yet
      </div>
    );
  }

  // Sorting function
  const getSortedPairs = () => {
    if (!sortConfig) return tradingPairs;

    return [...tradingPairs].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'ticker':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'entryPrice':
          aValue = a.entryPrice;
          bValue = b.entryPrice;
          break;
        case 'exitPrice':
          aValue = a.exitPrice;
          bValue = b.exitPrice;
          break;
        case 'shares':
          aValue = a.shares;
          bValue = b.shares;
          break;
        case 'entryTime':
          aValue = new Date(a.entryTime || 0).getTime();
          bValue = new Date(b.entryTime || 0).getTime();
          break;
        case 'exitTime':
          aValue = new Date(a.exitTime || 0).getTime();
          bValue = new Date(b.exitTime || 0).getTime();
          break;
        case 'profit':
          aValue = a.profitDollar;
          bValue = b.profitDollar;
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
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ChevronsUpDownIcon />;
    }
    return sortConfig.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };

  const sortedPairs = getSortedPairs();
  const totalPages = Math.ceil(sortedPairs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedPairs = sortedPairs.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('ticker')}
              >
                <div className="flex items-center gap-1">
                  Ticker
                  <SortIcon columnKey="ticker" />
                </div>
              </th>
              <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase">Side</th>
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
                onClick={() => handleSort('shares')}
              >
                <div className="flex items-center justify-end gap-1">
                  # of Shares
                  <SortIcon columnKey="shares" />
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
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('exitTime')}
              >
                <div className="flex items-center gap-1">
                  Exit Time
                  <SortIcon columnKey="exitTime" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Holding Time</th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('profit')}
              >
                <div className="flex items-center justify-end gap-1">
                  Profit $/(%
)
                  <SortIcon columnKey="profit" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Trading Account</th>
            </tr>
          </thead>
          <tbody>
            {paginatedPairs.map((pair, idx) => {
              return (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-white font-mono font-semibold">{pair.symbol}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      pair.side === 'LONG' 
                        ? 'bg-emerald-500/20 text-emerald-400' 
                        : 'bg-orange-500/20 text-orange-400'
                    }`}>
                      {pair.side}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-slate-300 font-mono">${pair.entryPrice.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`text-sm font-mono ${
                      pair.profitDollar >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      ${pair.exitPrice.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">{pair.shares.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDate(pair.entryTime || '')} {formatTime(pair.entryTime || '')}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDate(pair.exitTime || '')} {formatTime(pair.exitTime || '')}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-sm text-slate-300">
                      {calculateHoldingTime(pair.entryTime || '', pair.exitTime)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono font-semibold ${
                      pair.profitDollar >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {pair.profitDollar >= 0 ? '+' : ''}${pair.profitDollar.toFixed(2)}
                    </div>
                    <div className={`text-xs font-mono ${
                      pair.profitPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {pair.profitPercent >= 0 ? '+' : ''}{pair.profitPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
                      Alpaca Paper
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

// Pending Orders Table
function PendingOrdersTable({ orders, quotes }: { orders: any[], quotes: Record<string, any> }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'orderTime', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  if (orders.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
        No pending orders
      </div>
    );
  }

  // Sorting function
  const getSortedOrders = () => {
    if (!sortConfig) return orders;

    return [...orders].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'ticker':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'currentPrice':
          aValue = quotes[a.symbol]?.ap || 0;
          bValue = quotes[b.symbol]?.ap || 0;
          break;
        case 'orderPrice':
          aValue = parseFloat(a.limit_price || a.stop_price || 0);
          bValue = parseFloat(b.limit_price || b.stop_price || 0);
          break;
        case 'orderTime':
          aValue = new Date(a.created_at || 0).getTime();
          bValue = new Date(b.created_at || 0).getTime();
          break;
        case 'shares':
          aValue = parseFloat(a.qty || 0);
          bValue = parseFloat(b.qty || 0);
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
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
    setCurrentPage(1);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (!sortConfig || sortConfig.key !== columnKey) {
      return <ChevronsUpDownIcon />;
    }
    return sortConfig.direction === 'asc' ? <ChevronUpIcon /> : <ChevronDownIcon />;
  };

  const sortedOrders = getSortedOrders();
  const totalPages = Math.ceil(sortedOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = sortedOrders.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('ticker')}
              >
                <div className="flex items-center gap-1">
                  Ticker
                  <SortIcon columnKey="ticker" />
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
                onClick={() => handleSort('orderPrice')}
              >
                <div className="flex items-center justify-end gap-1">
                  Order Price $
                  <SortIcon columnKey="orderPrice" />
                </div>
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('orderTime')}
              >
                <div className="flex items-center gap-1">
                  Order Time
                  <SortIcon columnKey="orderTime" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Order Status</th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('shares')}
              >
                <div className="flex items-center justify-end gap-1">
                  # of Shares
                  <SortIcon columnKey="shares" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedOrders.map((order, idx) => {
              const currentPrice = quotes[order.symbol]?.ap || 0;
              const orderPrice = parseFloat(order.limit_price || order.stop_price || 0);
              const shares = parseFloat(order.qty || 0);
              
              return (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-white font-mono font-semibold">{order.symbol}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">
                      ${currentPrice > 0 ? currentPrice.toFixed(2) : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-slate-300 font-mono">
                      {orderPrice > 0 ? `$${orderPrice.toFixed(2)}` : 'Market'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDate(order.created_at || '')} {formatTime(order.created_at || '')}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-400">
                      {order.status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">{shares.toFixed(0)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <Pagination 
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
}

// Closed P/L Panel
function ClosedPLPanel({ stats, brokerId }: { stats: any; brokerId: string }) {
  const [dateRange, setDateRange] = useState<'1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'custom'>('1M');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [plData, setPLData] = useState<any>(null);
  const [account, setAccount] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadPLData();
  }, [dateRange, brokerId]);

  const loadPLData = async () => {
    try {
      setLoading(true);
      
      // Early return if no broker selected
      if (!brokerId) {
        console.log('📊 ClosedPLPanel: No broker selected, skipping data load');
        setLoading(false);
        return;
      }
      
      // Map UI date range to Alpaca period format
      const periodMap: Record<string, string> = {
        '1D': '1D',
        '1W': '1W',
        '1M': '1M',
        '3M': '3M',
        '6M': '6M',
        '1Y': '1A',
      };
      
      let portfolioHistory;
      if (dateRange === 'custom' && customStartDate && customEndDate) {
        // Use custom date range
        const startISO = new Date(customStartDate).toISOString().split('T')[0];
        const endISO = new Date(customEndDate).toISOString().split('T')[0];
        portfolioHistory = await alpacaAPI.getPortfolioHistory(brokerId, undefined, '1D', startISO, endISO);
      } else if (dateRange !== 'custom') {
        // Use predefined period
        portfolioHistory = await alpacaAPI.getPortfolioHistory(brokerId, periodMap[dateRange], '1D');
      }
      
      console.log('📊 ClosedPLPanel: Loading data for broker:', brokerId);
      console.log('📊 ClosedPLPanel: Date range:', dateRange);
      
      // Get account info, positions, and orders
      const [accountData, positionsData, ordersData] = await Promise.all([
        alpacaAPI.getAccount(brokerId),
        alpacaAPI.getPositions(brokerId),
        alpacaAPI.getOrders(brokerId, 'all', 500),
      ]);
      
      console.log('📊 ClosedPLPanel: Received data:');
      console.log('  - Portfolio history:', portfolioHistory);
      console.log('  - Account:', accountData);
      console.log('  - Positions:', positionsData?.length || 0);
      console.log('  - Orders:', ordersData?.length || 0);
      
      setPLData(portfolioHistory);
      setAccount(accountData);
      setPositions(positionsData);
      setOrders(ordersData);
    } catch (error) {
      console.error('Error loading P/L data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyCustomRange = () => {
    if (customStartDate && customEndDate) {
      loadPLData();
    }
  };

  // Calculate period P/L values
  const calculatePeriodPL = (period: string) => {
    if (!plData || !plData.equity || plData.equity.length === 0) {
      return { pl: 0, plPct: 0 };
    }

    const equity = plData.equity;
    const baseValue = plData.base_value || equity[0];
    
    let periodEquity = equity;
    
    // For different periods, we'd need to fetch different data
    // For now, we'll use the current data range
    const latestEquity = equity[equity.length - 1];
    const pl = latestEquity - baseValue;
    const plPct = baseValue > 0 ? (pl / baseValue) * 100 : 0;
    
    return { pl, plPct };
  };

  const currentPL = plData ? calculatePeriodPL(dateRange) : { pl: 0, plPct: 0 };
  
  // Calculate win rate from closed orders
  const totalTrades = stats.winningTrades + stats.losingTrades;
  const winRate = totalTrades > 0 ? ((stats.winningTrades / totalTrades) * 100).toFixed(1) : '0.0';

  // Aggregate trades by ticker
  const aggregateTradesByTicker = () => {
    const tickerMap = new Map<string, any>();
    
    // First, create trading pairs from closed orders
    const pairs: any[] = [];
    const filledOrders = orders.filter(o => o.status === 'filled');
    
    // Group orders by symbol
    const ordersBySymbol = new Map<string, any[]>();
    filledOrders.forEach(order => {
      const symbol = order.symbol;
      if (!ordersBySymbol.has(symbol)) {
        ordersBySymbol.set(symbol, []);
      }
      ordersBySymbol.get(symbol)!.push(order);
    });
    
    // For each symbol, match buy/sell pairs
    ordersBySymbol.forEach((symbolOrders, symbol) => {
      const sortedOrders = symbolOrders.sort((a, b) => {
        const timeA = new Date(a.filled_at || a.updated_at || a.created_at).getTime();
        const timeB = new Date(b.filled_at || b.updated_at || b.created_at).getTime();
        return timeA - timeB;
      });
      
      // Process orders sequentially to match entry/exit pairs
      for (let i = 0; i < sortedOrders.length - 1; i++) {
        const firstOrder = sortedOrders[i];
        const secondOrder = sortedOrders[i + 1];
        
        // Only pair if they are opposite sides
        if (firstOrder.side !== secondOrder.side) {
          const firstQty = parseFloat(firstOrder.filled_qty || firstOrder.qty || 0);
          const secondQty = parseFloat(secondOrder.filled_qty || secondOrder.qty || 0);
          const firstPrice = parseFloat(firstOrder.filled_avg_price || 0);
          const secondPrice = parseFloat(secondOrder.filled_avg_price || 0);
          const firstTime = firstOrder.filled_at || firstOrder.updated_at || firstOrder.created_at;
          const secondTime = secondOrder.filled_at || secondOrder.updated_at || secondOrder.created_at;
          
          const matchedQty = Math.min(firstQty, secondQty);
          
          // FIXED: Keep chronological order for times, use BUY/SELL for price calculation
          let profitDollar, profitPercent;
          let buyPrice, sellPrice;
          
          if (firstOrder.side === 'buy') {
            buyPrice = firstPrice;
            sellPrice = secondPrice;
          } else {
            buyPrice = secondPrice;
            sellPrice = firstPrice;
          }
          
          // LONG trade calculation
          profitDollar = (sellPrice - buyPrice) * matchedQty;
          profitPercent = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0;
          
          // Exit time is always the later time (secondTime)
          pairs.push({
            symbol: symbol,
            exitTime: secondTime,
            profitDollar: profitDollar,
            profitPercent: profitPercent,
          });
          
          i++; // Skip the paired order
        }
      }
    });
    
    // Now aggregate pairs by ticker
    pairs.forEach(pair => {
      const symbol = pair.symbol;
      const exitTime = new Date(pair.exitTime).getTime();
      const now = Date.now();
      
      // Calculate time periods in milliseconds
      const oneDayMs = 24 * 60 * 60 * 1000;
      const oneWeekMs = 7 * oneDayMs;
      const oneMonthMs = 30 * oneDayMs;
      const threeMonthMs = 90 * oneDayMs;
      const sixMonthMs = 180 * oneDayMs;
      const oneYearMs = 365 * oneDayMs;
      
      if (!tickerMap.has(symbol)) {
        tickerMap.set(symbol, {
          ticker: symbol,
          totalPairs: 0,
          winningPairs: 0,
          losingPairs: 0,
          totalPL: 0,
          pl1D: 0,
          pl1W: 0,
          pl1M: 0,
          pl3M: 0,
          pl6M: 0,
          pl1Y: 0,
        });
      }
      
      const ticker = tickerMap.get(symbol);
      ticker.totalPairs++;
      ticker.totalPL += pair.profitDollar;
      
      if (pair.profitDollar > 0) {
        ticker.winningPairs++;
      } else if (pair.profitDollar < 0) {
        ticker.losingPairs++;
      }
      
      // FIXED: Add DOLLAR amounts (not percentages) for each period
      // Period P/L shows the dollar profit/loss from trades closed in that period
      if (now - exitTime <= oneDayMs) {
        ticker.pl1D += pair.profitDollar;
      }
      if (now - exitTime <= oneWeekMs) {
        ticker.pl1W += pair.profitDollar;
      }
      if (now - exitTime <= oneMonthMs) {
        ticker.pl1M += pair.profitDollar;
      }
      if (now - exitTime <= threeMonthMs) {
        ticker.pl3M += pair.profitDollar;
      }
      if (now - exitTime <= sixMonthMs) {
        ticker.pl6M += pair.profitDollar;
      }
      if (now - exitTime <= oneYearMs) {
        ticker.pl1Y += pair.profitDollar;
      }
    });
    
    return Array.from(tickerMap.values());
  };

  const tickerData = aggregateTradesByTicker();

  const toggleTicker = (ticker: string) => {
    const newSet = new Set(selectedTickers);
    if (newSet.has(ticker)) {
      newSet.delete(ticker);
    } else {
      newSet.add(ticker);
    }
    setSelectedTickers(newSet);
  };

  const toggleAll = () => {
    if (selectedTickers.size === tickerData.length) {
      setSelectedTickers(new Set());
    } else {
      setSelectedTickers(new Set(tickerData.map(t => t.ticker)));
    }
  };

  return (
    <div className="space-y-6">
      {/* Date Range Filter */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-400">Time Range:</span>
          
          <div className="flex gap-2">
            {(['1D', '1W', '1M', '3M', '6M', '1Y', 'custom'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  dateRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {range === 'custom' ? 'Custom' : range}
              </button>
            ))}
          </div>
          
          {dateRange === 'custom' && (
            <div className="flex items-center gap-3 ml-4">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleApplyCustomRange}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
              >
                Apply
              </button>
            </div>
          )}
          
          <button
            onClick={loadPLData}
            className="ml-auto px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm transition-colors flex items-center gap-2"
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">Loading P/L data...</div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
              <div className="text-sm text-slate-400 mb-2">Total Profit/Loss ({dateRange})</div>
              <div className={`text-3xl font-mono font-semibold ${currentPL.pl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentPL.pl >= 0 ? '+' : ''}${currentPL.pl.toFixed(2)}
              </div>
              <div className={`text-sm font-mono ${currentPL.plPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentPL.plPct >= 0 ? '+' : ''}{currentPL.plPct.toFixed(2)}%
              </div>
            </div>
            
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
              <div className="text-sm text-slate-400 mb-2">Win Rate</div>
              <div className="text-3xl font-mono font-semibold text-blue-400">
                {winRate}%
              </div>
              <div className="text-sm text-slate-400">
                {stats.winningTrades} wins / {stats.losingTrades} losses
              </div>
            </div>
            
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
              <div className="text-sm text-slate-400 mb-2">Account Equity</div>
              <div className="text-3xl font-mono font-semibold text-white">
                ${account ? parseFloat(account.equity || 0).toFixed(2) : '0.00'}
              </div>
              <div className="text-sm text-slate-400">
                Cash: ${account ? parseFloat(account.cash || 0).toFixed(2) : '0.00'}
              </div>
            </div>
          </div>

          {/* Ticker Performance Table */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/50">
                    <th className="text-left px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedTickers.size === tickerData.length && tickerData.length > 0}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">Ticker</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider"># of Trades</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">Win Rate</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">1D P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">1W P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">1M P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">1Q P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">6M P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">1Y P/L $</th>
                    <th className="text-right px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">Total P/L $</th>
                  </tr>
                </thead>
                <tbody>
                  {tickerData.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-12 text-center text-slate-400">
                        No trades data available
                      </td>
                    </tr>
                  ) : (
                    tickerData.map((ticker, idx) => {
                      const winRatePct = ticker.totalPairs > 0 
                        ? ((ticker.winningPairs / ticker.totalPairs) * 100).toFixed(2)
                        : '0.00';
                      
                      return (
                        <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedTickers.has(ticker.ticker)}
                              onChange={() => toggleTicker(ticker.ticker)}
                              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <span className="text-sm text-blue-400 font-semibold cursor-pointer hover:underline">
                              {ticker.ticker}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className="text-sm text-white font-semibold">
                              {ticker.totalPairs}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className={`text-sm font-semibold ${
                              parseFloat(winRatePct) >= 60 ? 'text-emerald-400' : 
                              parseFloat(winRatePct) >= 40 ? 'text-yellow-400' : 'text-rose-400'
                            }`}>
                              {winRatePct}%
                            </span>
                          </td>
                          
                          {/* 1D P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl1D !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl1D >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl1D >= 0 ? '+' : ''}${ticker.pl1D.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* 1W P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl1W !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl1W >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl1W >= 0 ? '+' : ''}${ticker.pl1W.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* 1M P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl1M !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl1M >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl1M >= 0 ? '+' : ''}${ticker.pl1M.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* 1Q P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl3M !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl3M >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl3M >= 0 ? '+' : ''}${ticker.pl3M.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* 6M P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl6M !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl6M >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl6M >= 0 ? '+' : ''}${ticker.pl6M.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* 1Y P/L */}
                          <td className="px-4 py-4 text-right">
                            {ticker.pl1Y !== 0 ? (
                              <span className={`text-sm font-mono ${
                                ticker.pl1Y >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.pl1Y >= 0 ? '+' : ''}${ticker.pl1Y.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500">N/A</span>
                            )}
                          </td>
                          
                          {/* Total P/L */}
                          <td className="px-4 py-4 text-right">
                            <div>
                              <div className={`text-sm font-mono font-semibold ${
                                ticker.totalPL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {ticker.totalPL >= 0 ? '+' : ''}${ticker.totalPL.toFixed(2)}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            
            {tickerData.length > 0 && (
              <div className="px-4 py-3 bg-slate-900/30 border-t border-slate-700 text-sm text-slate-400">
                * Period P/L columns show dollar profit/loss from closed trading pairs within each time period. Total P/L shows cumulative dollar profit/loss across all trades.
              </div>
            )}
          </div>

          {/* Export Options */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
            <h3 className="text-lg text-white mb-4">Export Data</h3>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  // Export ticker P/L summary to CSV
                  const headers = ['Ticker', '# of Trades', 'Win Rate %', '1D P/L $', '1W P/L $', '1M P/L $', '1Q P/L $', '6M P/L $', '1Y P/L $', 'Total P/L $'];
                  const rows = tickerData.map(ticker => {
                    const winRatePct = ticker.totalPairs > 0 
                      ? ((ticker.winningPairs / ticker.totalPairs) * 100).toFixed(2)
                      : '0.00';
                    return [
                      ticker.ticker,
                      ticker.totalPairs,
                      winRatePct,
                      ticker.pl1D !== 0 ? ticker.pl1D.toFixed(2) : 'N/A',
                      ticker.pl1W !== 0 ? ticker.pl1W.toFixed(2) : 'N/A',
                      ticker.pl1M !== 0 ? ticker.pl1M.toFixed(2) : 'N/A',
                      ticker.pl3M !== 0 ? ticker.pl3M.toFixed(2) : 'N/A',
                      ticker.pl6M !== 0 ? ticker.pl6M.toFixed(2) : 'N/A',
                      ticker.pl1Y !== 0 ? ticker.pl1Y.toFixed(2) : 'N/A',
                      ticker.totalPL.toFixed(2),
                    ];
                  });
                  
                  const csvContent = [
                    headers.join(','),
                    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
                  ].join('\n');
                  
                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ticker_pl_${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <DownloadIcon />
                Export Ticker P/L CSV
              </button>
              
              <button
                onClick={() => {
                  if (!plData || !plData.equity) return;
                  
                  // Export detailed portfolio history to CSV
                  const headers = ['Timestamp', 'Equity', 'Profit/Loss', 'Profit/Loss %'];
                  const rows = (plData.timestamp || []).map((ts: number, idx: number) => [
                    new Date(ts * 1000).toLocaleString(),
                    plData.equity[idx]?.toFixed(2) || '0',
                    plData.profit_loss?.[idx]?.toFixed(2) || '0',
                    plData.profit_loss_pct?.[idx]?.toFixed(2) || '0'
                  ]);
                  
                  const csvContent = [
                    headers.join(','),
                    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
                  ].join('\n');
                  
                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `portfolio_history_${dateRange}_${new Date().toISOString().split('T')[0]}.csv`;
                  a.click();
                  window.URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <DownloadIcon />
                Export Portfolio History
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Performance Panel
function PerformancePanel({ orders }: { orders: any[] }) {
  const tradingPairs = createTradingPairs(orders);
  const metrics = calculatePerformanceMetricsFromPairs(tradingPairs);

  const metricsData = [
    {
      name: 'Annualized Return',
      description: 'This measures the percentage gain or loss of an investment over a year where returns longer than a year are averaged and returns shorter than a year are projected.',
      value: `${metrics.annualizedReturn >= 0 ? '+' : ''}${metrics.annualizedReturn.toFixed(2)}%`,
      color: metrics.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      name: 'Cumulative Return',
      description: 'The total percentage gain or loss of an investment over the entire period it\'s been held.',
      value: `${metrics.cumulativeReturn >= 0 ? '+' : ''}${metrics.cumulativeReturn.toFixed(2)}%`,
      color: metrics.cumulativeReturn >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      name: 'Annual Volatility',
      description: 'Measures the standard deviation of the investment\'s daily returns, reflecting how much the investment\'s value fluctuates. Lower is generally better: < 15% is considered low, > 30% high.',
      value: `${metrics.annualVolatility.toFixed(2)}%`,
      color: metrics.annualVolatility < 15 ? 'text-emerald-400' : metrics.annualVolatility < 30 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Sharpe Ratio',
      description: 'Measures risk-adjusted return: the higher, the better. > 1 is good, > 2 is very good, > 3 is excellent. Negative shows that the return risk is greater than the returns and by what degree. The risk-free rate is divided into 252 business days from an expected 2% per year.',
      value: metrics.sharpeRatio.toFixed(2),
      color: metrics.sharpeRatio > 2 ? 'text-emerald-400' : metrics.sharpeRatio > 1 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Calmar Ratio',
      description: 'The ratio compares the annual return to the maximum drawdown. Higher is better.',
      value: metrics.calmarRatio.toFixed(2),
      color: metrics.calmarRatio > 1 ? 'text-emerald-400' : metrics.calmarRatio > 0 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Stability',
      description: 'Reflects the consistency of the returns. 0 to 1: closer to 1 indicates more consistency.',
      value: metrics.stability.toFixed(2),
      color: metrics.stability > 0.7 ? 'text-emerald-400' : metrics.stability > 0.4 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Max Drawdown',
      description: 'The largest peak-to-trough decline in investment value. Smaller (less negative) is better.',
      value: `${metrics.maxDrawdown.toFixed(2)}%`,
      color: metrics.maxDrawdown > -10 ? 'text-emerald-400' : metrics.maxDrawdown > -20 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Omega',
      description: 'Compares the likelihood of gains versus losses. > 1 is favorable. The risk-free rate is divided into 252 business days from an expected 2% per year.',
      value: metrics.omega.toFixed(2),
      color: metrics.omega > 1 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      name: 'Sortino Ratio',
      description: 'Similar to the Sharpe Ratio but only considers downside volatility. Higher is better; similar scale to Sharpe Ratio.',
      value: metrics.sortinoRatio.toFixed(2),
      color: metrics.sortinoRatio > 2 ? 'text-emerald-400' : metrics.sortinoRatio > 1 ? 'text-yellow-400' : 'text-rose-400',
    },
    {
      name: 'Tail Ratio',
      description: 'The ratio of the far right (95th percentile) to the far left (5th percentile) of the return distribution. Higher than 1 is good.',
      value: metrics.tailRatio.toFixed(2),
      color: metrics.tailRatio > 1 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      name: 'Daily Value At Risk',
      description: 'Estimates the maximum potential loss in value of a portfolio over a given time frame. Smaller (less negative) is better.',
      value: `${metrics.dailyVaR.toFixed(2)}%`,
      color: metrics.dailyVaR > -2 ? 'text-emerald-400' : metrics.dailyVaR > -5 ? 'text-yellow-400' : 'text-rose-400',
    },
  ];

  if (tradingPairs.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
        No closed trading pairs available for performance analysis
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Total Trading Pairs</div>
          <div className="text-3xl font-mono font-semibold text-blue-400">
            {tradingPairs.length}
          </div>
        </div>
        
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Cumulative Return</div>
          <div className={`text-3xl font-mono font-semibold ${metrics.cumulativeReturn >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {metrics.cumulativeReturn >= 0 ? '+' : ''}{metrics.cumulativeReturn.toFixed(2)}%
          </div>
        </div>
        
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Sharpe Ratio</div>
          <div className={`text-3xl font-mono font-semibold ${
            metrics.sharpeRatio > 2 ? 'text-emerald-400' : 
            metrics.sharpeRatio > 1 ? 'text-yellow-400' : 'text-rose-400'
          }`}>
            {metrics.sharpeRatio.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Metrics Table */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 bg-slate-900/50">
          <h3 className="text-lg text-white">METRICS</h3>
        </div>
        
        <div className="divide-y divide-slate-700">
          {metricsData.map((metric, idx) => (
            <div key={idx} className="px-6 py-6 hover:bg-slate-700/30 transition-colors">
              <div className="flex items-start justify-between gap-8">
                <div className="flex-1">
                  <div className="text-white font-semibold mb-2">{metric.name}</div>
                  <div className="text-sm text-slate-400">{metric.description}</div>
                </div>
                <div className={`text-2xl font-mono font-semibold whitespace-nowrap ${metric.color}`}>
                  {metric.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <h3 className="text-lg text-white mb-4">Export Data</h3>
        <button
          onClick={() => {
            const headers = ['Metric', 'Value', 'Description'];
            const rows = metricsData.map(m => [
              m.name,
              m.value,
              m.description,
            ]);
            
            const csvContent = [
              headers.join(','),
              ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `performance_metrics_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <DownloadIcon />
          Export Performance Metrics
        </button>
      </div>
    </div>
  );
}

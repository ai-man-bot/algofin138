import { useState } from 'react';

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
  
  let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
  let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
  
  if (endPage - startPage < maxPagesToShow - 1) {
    startPage = Math.max(1, endPage - maxPagesToShow + 1);
  }
  
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-2 py-4 border-t border-slate-700">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm text-white"
      >
        Previous
      </button>
      
      {startPage > 1 && (
        <>
          <button
            onClick={() => onPageChange(1)}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-sm text-white"
          >
            1
          </button>
          {startPage > 2 && <span className="text-slate-500">...</span>}
        </>
      )}
      
      {pages.map((page) => (
        <button
          key={page}
          onClick={() => onPageChange(page)}
          className={`px-3 py-1 rounded transition-colors text-sm ${
            currentPage === page
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-white'
          }`}
        >
          {page}
        </button>
      ))}
      
      {endPage < totalPages && (
        <>
          {endPage < totalPages - 1 && <span className="text-slate-500">...</span>}
          <button
            onClick={() => onPageChange(totalPages)}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors text-sm text-white"
          >
            {totalPages}
          </button>
        </>
      )}
      
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm text-white"
      >
        Next
      </button>
    </div>
  );
}

// Format utility functions
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

const formatDateTime = (timestamp: string) => {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

// Open Trades Table - Matches Alpaca Positions
export function NewOpenTradesTable({ trades, quotes }: { trades: any[], quotes: Record<string, any> }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'symbol', direction: 'asc' });
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
        case 'symbol':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'price':
          aValue = quotes[a.symbol]?.ap || parseFloat(a.current_price || 0);
          bValue = quotes[b.symbol]?.ap || parseFloat(b.current_price || 0);
          break;
        case 'qty':
          aValue = parseFloat(a.qty || 0);
          bValue = parseFloat(b.qty || 0);
          break;
        case 'marketValue':
          aValue = parseFloat(a.market_value || 0);
          bValue = parseFloat(b.market_value || 0);
          break;
        case 'avgEntry':
          aValue = parseFloat(a.avg_entry_price || 0);
          bValue = parseFloat(b.avg_entry_price || 0);
          break;
        case 'costBasis':
          aValue = parseFloat(a.cost_basis || 0);
          bValue = parseFloat(b.cost_basis || 0);
          break;
        case 'todayPLPercent':
          aValue = parseFloat(a.unrealized_intraday_plpc || 0);
          bValue = parseFloat(b.unrealized_intraday_plpc || 0);
          break;
        case 'todayPL':
          aValue = parseFloat(a.unrealized_intraday_pl || 0);
          bValue = parseFloat(b.unrealized_intraday_pl || 0);
          break;
        case 'totalPLPercent':
          aValue = parseFloat(a.unrealized_plpc || 0);
          bValue = parseFloat(b.unrealized_plpc || 0);
          break;
        case 'totalPL':
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
                onClick={() => handleSort('symbol')}
              >
                <div className="flex items-center gap-1">
                  Asset
                  <SortIcon columnKey="symbol" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('price')}
              >
                <div className="flex items-center justify-end gap-1">
                  Price
                  <SortIcon columnKey="price" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('qty')}
              >
                <div className="flex items-center justify-end gap-1">
                  Qty
                  <SortIcon columnKey="qty" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Side</th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('marketValue')}
              >
                <div className="flex items-center justify-end gap-1">
                  Market Value
                  <SortIcon columnKey="marketValue" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('avgEntry')}
              >
                <div className="flex items-center justify-end gap-1">
                  Avg Entry
                  <SortIcon columnKey="avgEntry" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('costBasis')}
              >
                <div className="flex items-center justify-end gap-1">
                  Cost Basis
                  <SortIcon columnKey="costBasis" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('todayPLPercent')}
              >
                <div className="flex items-center justify-end gap-1">
                  Today's P/L (%)
                  <SortIcon columnKey="todayPLPercent" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('todayPL')}
              >
                <div className="flex items-center justify-end gap-1">
                  Today's P/L ($)
                  <SortIcon columnKey="todayPL" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('totalPLPercent')}
              >
                <div className="flex items-center justify-end gap-1">
                  Total P/L (%)
                  <SortIcon columnKey="totalPLPercent" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('totalPL')}
              >
                <div className="flex items-center justify-end gap-1">
                  Total P/L ($)
                  <SortIcon columnKey="totalPL" />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedTrades.map((trade, idx) => {
              const currentPrice = quotes[trade.symbol]?.ap || parseFloat(trade.current_price || 0);
              const qty = parseFloat(trade.qty || 0);
              const side = parseFloat(trade.qty || 0) >= 0 ? 'Long' : 'Short';
              const marketValue = parseFloat(trade.market_value || 0);
              const avgEntry = parseFloat(trade.avg_entry_price || 0);
              const costBasis = parseFloat(trade.cost_basis || 0);
              
              // Today's P/L
              const todayPL = parseFloat(trade.unrealized_intraday_pl || 0);
              const todayPLPercent = parseFloat(trade.unrealized_intraday_plpc || 0) * 100;
              
              // Total P/L
              const unrealizedPL = parseFloat(trade.unrealized_pl || 0);
              const unrealizedPLPercent = parseFloat(trade.unrealized_plpc || 0) * 100;
              
              return (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-blue-400 font-mono font-semibold">
                      {trade.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">${currentPrice.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">{Math.abs(qty).toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-sm ${side === 'Long' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {side}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">${marketValue.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-slate-300 font-mono">${avgEntry.toFixed(4)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-slate-300 font-mono">${costBasis.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono ${todayPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {todayPL >= 0 ? '+' : ''}{todayPLPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono ${todayPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${todayPL >= 0 ? '+' : ''}{todayPL.toFixed(2)}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono ${unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {unrealizedPL >= 0 ? '+' : ''}{unrealizedPLPercent.toFixed(2)}%
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className={`text-sm font-mono font-semibold ${unrealizedPL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${unrealizedPL >= 0 ? '+' : ''}{unrealizedPL.toFixed(2)}
                    </div>
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

// Orders Table - Matches Alpaca Orders
export function OrdersTable({ orders }: { orders: any[] }) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'submitted_at', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  if (orders.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center text-slate-400">
        No orders
      </div>
    );
  }

  // Sorting function
  const getSortedOrders = () => {
    if (!sortConfig) return orders;

    return [...orders].sort((a, b) => {
      let aValue, bValue;

      switch (sortConfig.key) {
        case 'symbol':
          aValue = a.symbol || '';
          bValue = b.symbol || '';
          break;
        case 'type':
          aValue = a.type || a.order_type || '';
          bValue = b.type || b.order_type || '';
          break;
        case 'side':
          aValue = a.side || '';
          bValue = b.side || '';
          break;
        case 'qty':
          aValue = parseFloat(a.qty || a.filled_qty || 0);
          bValue = parseFloat(b.qty || b.filled_qty || 0);
          break;
        case 'fillPrice':
          aValue = parseFloat(a.filled_avg_price || a.limit_price || 0);
          bValue = parseFloat(b.filled_avg_price || b.limit_price || 0);
          break;
        case 'totalAmount':
          aValue = parseFloat(a.filled_qty || a.qty || 0) * parseFloat(a.filled_avg_price || a.limit_price || 0);
          bValue = parseFloat(b.filled_qty || b.qty || 0) * parseFloat(b.filled_avg_price || b.limit_price || 0);
          break;
        case 'submitted_at':
          aValue = new Date(a.submitted_at || 0).getTime();
          bValue = new Date(b.submitted_at || 0).getTime();
          break;
        case 'filled_at':
          aValue = new Date(a.filled_at || 0).getTime();
          bValue = new Date(b.filled_at || 0).getTime();
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
                onClick={() => handleSort('symbol')}
              >
                <div className="flex items-center gap-1">
                  Asset
                  <SortIcon columnKey="symbol" />
                </div>
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('type')}
              >
                <div className="flex items-center gap-1">
                  Order Type
                  <SortIcon columnKey="type" />
                </div>
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('side')}
              >
                <div className="flex items-center gap-1">
                  Side
                  <SortIcon columnKey="side" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('qty')}
              >
                <div className="flex items-center justify-end gap-1">
                  Qty
                  <SortIcon columnKey="qty" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('fillPrice')}
              >
                <div className="flex items-center justify-end gap-1">
                  Avg. Fill Price
                  <SortIcon columnKey="fillPrice" />
                </div>
              </th>
              <th 
                className="text-right px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('totalAmount')}
              >
                <div className="flex items-center justify-end gap-1">
                  Total Amount
                  <SortIcon columnKey="totalAmount" />
                </div>
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('submitted_at')}
              >
                <div className="flex items-center gap-1">
                  Submitted At
                  <SortIcon columnKey="submitted_at" />
                </div>
              </th>
              <th 
                className="text-left px-4 py-3 text-xs text-slate-400 uppercase cursor-pointer hover:bg-slate-700/30 transition-colors"
                onClick={() => handleSort('filled_at')}
              >
                <div className="flex items-center gap-1">
                  Filled At
                  <SortIcon columnKey="filled_at" />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Status</th>
            </tr>
          </thead>
          <tbody>
            {paginatedOrders.map((order, idx) => {
              const qty = parseFloat(order.filled_qty || order.qty || 0);
              const fillPrice = parseFloat(order.filled_avg_price || order.limit_price || 0);
              const totalAmount = qty * fillPrice;
              const orderType = (order.type || order.order_type || 'market').charAt(0).toUpperCase() + (order.type || order.order_type || 'market').slice(1);
              const status = order.status || 'unknown';
              const statusColor = 
                status === 'filled' ? 'text-emerald-400' :
                status === 'canceled' || status === 'expired' ? 'text-slate-500' :
                'text-yellow-400';
              
              return (
                <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors">
                  <td className="px-4 py-4">
                    <span className="text-sm text-blue-400 font-mono font-semibold">
                      {order.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-sm text-slate-300">
                      {orderType}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-sm ${order.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {order.side}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">{qty.toFixed(2)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">
                      {fillPrice > 0 ? `$${fillPrice.toFixed(2)}` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-sm text-white font-mono">
                      {totalAmount > 0 ? `$${totalAmount.toFixed(2)}` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDateTime(order.submitted_at)}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-slate-300">
                      {formatDateTime(order.filled_at)}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-sm ${statusColor}`}>
                      {status}
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
export interface StrategyBacktestData {
  initialCapital: number;
  netProfit: number;
  netProfitPercent: number;
  maxEquityDrawdown: number;
  maxEquityDrawdownPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  percentProfitable: number;
  avgPnL: number;
  avgWinningTrade: number;
  avgLosingTrade: number;
  ratioAvgWinLoss: number;
  sharpeRatio: number;
  profitFactor: number;
  properties?: Record<string, any>;
  fileName?: string;
  uploadedAt?: string;
}

export interface TradeLike {
  id?: string;
  strategyId?: string;
  strategyName?: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number | null;
  status?: string;
  submittedAt?: string;
  filledAt?: string;
  closedAt?: string;
}

export interface OrderLike {
  symbol?: string;
  side?: string;
  status?: string;
  qty?: number | string;
  filled_qty?: number | string;
  filled_avg_price?: number | string;
  updated_at?: string;
  created_at?: string;
  filled_at?: string;
}

export interface TradingPair {
  symbol: string;
  entryTime: string;
  exitTime: string;
  profitDollar: number;
  profitPercent: number;
  return: number;
}

export interface PerformanceMetrics {
  totalPnL: number;
  totalPnLPercent: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  expectancy: number;
}

export interface AdvancedPerformanceMetrics {
  annualizedReturn: number;
  cumulativeReturn: number;
  annualVolatility: number;
  sharpeRatio: number;
  calmarRatio: number;
  stability: number;
  maxDrawdown: number;
  omega: number;
  sortinoRatio: number;
  tailRatio: number;
  dailyVaR: number;
}

export interface DivergenceAlert {
  metric: string;
  backtest: number;
  live: number;
  divergence: number;
  severity: 'high' | 'medium' | 'low';
  description: string;
}

const DEFAULT_STARTING_CAPITAL = 100000;
const ANNUAL_RISK_FREE_RATE = 0.02;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getTimestamp(value?: string) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function createTradingPairs(orders: OrderLike[]): TradingPair[] {
  const pairs: TradingPair[] = [];
  const filledOrders = orders.filter((order) => order.status === 'filled' && order.symbol);
  const ordersBySymbol = new Map<string, OrderLike[]>();

  filledOrders.forEach((order) => {
    const symbol = String(order.symbol);
    const existing = ordersBySymbol.get(symbol) ?? [];
    existing.push(order);
    ordersBySymbol.set(symbol, existing);
  });

  ordersBySymbol.forEach((symbolOrders, symbol) => {
    const sortedOrders = [...symbolOrders].sort((a, b) => {
      return getTimestamp(a.filled_at || a.updated_at || a.created_at) - getTimestamp(b.filled_at || b.updated_at || b.created_at);
    });

    for (let i = 0; i < sortedOrders.length - 1; i += 1) {
      const firstOrder = sortedOrders[i];
      const secondOrder = sortedOrders[i + 1];

      if (firstOrder.side === secondOrder.side) continue;

      const firstQty = Math.abs(toNumber(firstOrder.filled_qty || firstOrder.qty));
      const secondQty = Math.abs(toNumber(secondOrder.filled_qty || secondOrder.qty));
      const matchedQty = Math.min(firstQty, secondQty);

      if (!matchedQty) continue;

      const firstPrice = toNumber(firstOrder.filled_avg_price);
      const secondPrice = toNumber(secondOrder.filled_avg_price);
      const firstTime = firstOrder.filled_at || firstOrder.updated_at || firstOrder.created_at || '';
      const secondTime = secondOrder.filled_at || secondOrder.updated_at || secondOrder.created_at || '';

      let profitDollar = 0;
      let profitPercent = 0;

      if (firstOrder.side === 'buy') {
        profitDollar = (secondPrice - firstPrice) * matchedQty;
        profitPercent = firstPrice > 0 ? ((secondPrice - firstPrice) / firstPrice) * 100 : 0;
      } else {
        profitDollar = (firstPrice - secondPrice) * matchedQty;
        profitPercent = firstPrice > 0 ? ((firstPrice - secondPrice) / firstPrice) * 100 : 0;
      }

      pairs.push({
        symbol,
        entryTime: firstTime,
        exitTime: secondTime,
        profitDollar,
        profitPercent,
        return: profitPercent / 100,
      });
    }
  });

  return pairs;
}

export function calculatePerformanceMetricsFromPairs(tradingPairs: TradingPair[]): AdvancedPerformanceMetrics {
  if (tradingPairs.length === 0) {
    return {
      annualizedReturn: 0,
      cumulativeReturn: 0,
      annualVolatility: 0,
      sharpeRatio: 0,
      calmarRatio: 0,
      stability: 0,
      maxDrawdown: 0,
      omega: 0,
      sortinoRatio: 0,
      tailRatio: 0,
      dailyVaR: 0,
    };
  }

  const returns = tradingPairs.map((pair) => pair.profitPercent / 100);
  const returnsPct = tradingPairs.map((pair) => pair.profitPercent);
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const sortedReturnsPct = [...returnsPct].sort((a, b) => a - b);
  const avgReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;

  const sortedByTime = [...tradingPairs].sort((a, b) => getTimestamp(a.exitTime) - getTimestamp(b.exitTime));
  const firstTradeTime = getTimestamp(sortedByTime[0]?.exitTime);
  const lastTradeTime = getTimestamp(sortedByTime[sortedByTime.length - 1]?.exitTime);
  const daysElapsed = Math.max(1, (lastTradeTime - firstTradeTime) / (1000 * 60 * 60 * 24));
  const yearsElapsed = daysElapsed / 365;
  const tradesPerYear = tradingPairs.length / yearsElapsed;
  const annualizedReturn = avgReturn * tradesPerYear;

  const variance = returns.reduce((sum, value) => sum + Math.pow(value - avgReturn, 2), 0) / returns.length;
  const annualVolatility = Math.sqrt(variance) * Math.sqrt(Math.max(1, tradesPerYear));
  const excessReturn = annualizedReturn - ANNUAL_RISK_FREE_RATE;
  const sharpeRatio = annualVolatility > 0 ? excessReturn / annualVolatility : 0;

  let peak = 0;
  let maxDrawdown = 0;
  let cumulative = 0;
  sortedByTime.forEach((pair) => {
    cumulative += pair.profitDollar;
    if (cumulative > peak) peak = cumulative;
    if (peak > 0) {
      const drawdown = (peak - cumulative) / Math.abs(peak);
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  });

  const calmarRatio = maxDrawdown > 0 ? Math.abs(annualizedReturn) / maxDrawdown : 0;

  const n = returns.length;
  let stability = 0;
  if (n >= 2) {
    const x = Array.from({ length: n }, (_, index) => index);
    const y = returns.map((_, index) => returns.slice(0, index + 1).reduce((sum, value) => sum + value, 0));
    const meanX = x.reduce((sum, value) => sum + value, 0) / n;
    const meanY = y.reduce((sum, value) => sum + value, 0) / n;
    const numerator = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0);
    const denominator = x.reduce((sum, value) => sum + Math.pow(value - meanX, 2), 0);
    const slope = denominator > 0 ? numerator / denominator : 0;
    const ssRes = x.reduce((sum, value, index) => {
      const predicted = meanY + slope * (value - meanX);
      return sum + Math.pow(y[index] - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, value) => sum + Math.pow(value - meanY, 2), 0);
    stability = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  }

  const downsideReturns = returns.filter((value) => value < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, value) => sum + Math.pow(value, 2), 0) / downsideReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance) * Math.sqrt(Math.max(1, tradesPerYear));
  const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;

  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const omega = losses > 0 ? gains / losses : gains > 0 ? 999 : 0;

  const percentile5 = sortedReturns[Math.max(0, Math.floor(sortedReturns.length * 0.05))] || 0;
  const percentile95 = sortedReturns[Math.min(sortedReturns.length - 1, Math.floor(sortedReturns.length * 0.95))] || 0;
  const tailRatio = percentile5 < 0 ? Math.abs(percentile95 / percentile5) : 0;
  const dailyVaR = sortedReturnsPct[Math.max(0, Math.floor(sortedReturnsPct.length * 0.05))] || 0;

  return {
    annualizedReturn: annualizedReturn * 100,
    cumulativeReturn: avgReturn * 100,
    annualVolatility: annualVolatility * 100,
    sharpeRatio,
    calmarRatio,
    stability: Math.min(1, Math.max(0, stability)),
    maxDrawdown: -maxDrawdown * 100,
    omega,
    sortinoRatio,
    tailRatio,
    dailyVaR,
  };
}

export function calculateBacktestMetrics(backtestData: StrategyBacktestData): PerformanceMetrics {
  const downside = Math.abs(backtestData.avgLosingTrade || 0);
  const sortinoRatio = downside > 0 ? (backtestData.avgPnL || 0) / downside : 0;
  const calmarRatio = backtestData.maxEquityDrawdownPercent > 0
    ? Math.abs(backtestData.netProfitPercent) / backtestData.maxEquityDrawdownPercent
    : 0;

  return {
    totalPnL: backtestData.netProfit || 0,
    totalPnLPercent: backtestData.netProfitPercent || 0,
    winRate: backtestData.percentProfitable || 0,
    profitFactor: backtestData.profitFactor || 0,
    maxDrawdown: Math.abs(backtestData.maxEquityDrawdown) || 0,
    maxDrawdownPercent: backtestData.maxEquityDrawdownPercent || 0,
    avgWin: backtestData.avgWinningTrade || 0,
    avgLoss: downside,
    totalTrades: backtestData.totalTrades || 0,
    winningTrades: backtestData.winningTrades || 0,
    losingTrades: backtestData.losingTrades || 0,
    sharpeRatio: backtestData.sharpeRatio || 0,
    sortinoRatio,
    calmarRatio,
    expectancy: backtestData.avgPnL || 0,
  };
}

export function calculateLiveMetricsFromTrades(trades: TradeLike[], startingCapital = DEFAULT_STARTING_CAPITAL): PerformanceMetrics | null {
  const closedTrades = trades.filter((trade) =>
    trade.status === 'filled' && trade.pnl !== undefined && trade.pnl !== null
  );

  if (closedTrades.length === 0) return null;

  const totalPnL = closedTrades.reduce((sum, trade) => sum + toNumber(trade.pnl), 0);
  const winningTrades = closedTrades.filter((trade) => toNumber(trade.pnl) > 0);
  const losingTrades = closedTrades.filter((trade) => toNumber(trade.pnl) < 0);
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, trade) => sum + toNumber(trade.pnl), 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, trade) => sum + toNumber(trade.pnl), 0) / losingTrades.length)
    : 0;
  const winRate = (winningTrades.length / closedTrades.length) * 100;
  const profitFactor = avgLoss > 0 ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length) : 0;

  const sortedTrades = [...closedTrades].sort((a, b) => {
    const aTime = getTimestamp(a.closedAt || a.filledAt || a.submittedAt);
    const bTime = getTimestamp(b.closedAt || b.filledAt || b.submittedAt);
    return aTime - bTime;
  });

  let equity = startingCapital;
  let maxEquity = startingCapital;
  let worstEquity = startingCapital;
  let maxDrawdownPercent = 0;
  const returns: number[] = [];
  const downsideReturns: number[] = [];

  sortedTrades.forEach((trade) => {
    const pnl = toNumber(trade.pnl);
    const baseEquity = equity === 0 ? startingCapital : equity;
    const tradeReturn = baseEquity !== 0 ? pnl / Math.abs(baseEquity) : 0;
    returns.push(tradeReturn);
    if (tradeReturn < 0) downsideReturns.push(tradeReturn);

    equity += pnl;
    if (equity > maxEquity) maxEquity = equity;
    if (equity < worstEquity) worstEquity = equity;

    const drawdownPercent = maxEquity > 0 ? ((maxEquity - equity) / maxEquity) * 100 : 0;
    if (drawdownPercent > maxDrawdownPercent) maxDrawdownPercent = drawdownPercent;
  });

  const totalPnLPercent = startingCapital !== 0 ? (totalPnL / Math.abs(startingCapital)) * 100 : 0;
  const avgReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, value) => sum + Math.pow(value, 2), 0) / downsideReturns.length
    : 0;
  const sortinoRatio = downsideVariance > 0 ? avgReturn / Math.sqrt(downsideVariance) : 0;
  const calmarRatio = maxDrawdownPercent > 0 ? Math.abs(totalPnLPercent) / maxDrawdownPercent : 0;

  return {
    totalPnL,
    totalPnLPercent,
    winRate,
    profitFactor,
    maxDrawdown: maxEquity - worstEquity,
    maxDrawdownPercent,
    avgWin,
    avgLoss,
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    expectancy: (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss,
  };
}

export function calculateDivergenceAlerts(backtestData: StrategyBacktestData, live: PerformanceMetrics | null): DivergenceAlert[] {
  if (!live) return [];

  const alerts: DivergenceAlert[] = [];
  const winRateDiff = Math.abs(backtestData.percentProfitable - live.winRate);
  if (winRateDiff > 10) {
    alerts.push({
      metric: 'Win Rate',
      backtest: backtestData.percentProfitable,
      live: live.winRate,
      divergence: winRateDiff,
      severity: winRateDiff > 20 ? 'high' : 'medium',
      description: `Live win rate is ${live.winRate < backtestData.percentProfitable ? 'lower' : 'higher'} than backtest by ${winRateDiff.toFixed(1)}%`,
    });
  }

  const backtestProfitFactor = backtestData.profitFactor || 0;
  if (backtestProfitFactor > 0) {
    const pfDiffPercent = (Math.abs(backtestProfitFactor - live.profitFactor) / backtestProfitFactor) * 100;
    if (pfDiffPercent > 20) {
      alerts.push({
        metric: 'Profit Factor',
        backtest: backtestProfitFactor,
        live: live.profitFactor,
        divergence: pfDiffPercent,
        severity: pfDiffPercent > 40 ? 'high' : 'medium',
        description: `Live profit factor is ${live.profitFactor < backtestProfitFactor ? 'lower' : 'higher'} than backtest by ${pfDiffPercent.toFixed(1)}%`,
      });
    }
  }

  const drawdownDiff = Math.abs(backtestData.maxEquityDrawdownPercent - live.maxDrawdownPercent);
  if (drawdownDiff > 5) {
    alerts.push({
      metric: 'Max Drawdown',
      backtest: backtestData.maxEquityDrawdownPercent,
      live: live.maxDrawdownPercent,
      divergence: drawdownDiff,
      severity: live.maxDrawdownPercent > backtestData.maxEquityDrawdownPercent ? 'high' : 'low',
      description: `Live drawdown is ${live.maxDrawdownPercent > backtestData.maxEquityDrawdownPercent ? 'worse' : 'better'} than backtest by ${drawdownDiff.toFixed(1)}%`,
    });
  }

  const returnDiff = Math.abs(backtestData.netProfitPercent - live.totalPnLPercent);
  if (returnDiff > 15) {
    alerts.push({
      metric: 'Total Return',
      backtest: backtestData.netProfitPercent,
      live: live.totalPnLPercent,
      divergence: returnDiff,
      severity: returnDiff > 30 ? 'high' : 'medium',
      description: `Live returns are ${live.totalPnLPercent < backtestData.netProfitPercent ? 'underperforming' : 'outperforming'} backtest by ${returnDiff.toFixed(1)}%`,
    });
  }

  return alerts;
}

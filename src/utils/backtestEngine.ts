import {
  createStrategyLabStrategyDefinition,
  type StrategyLabBar,
  type StrategyLabStrategyDefinition,
} from './strategyLabModels.ts';

export interface StrategyLabBacktestTrade {
  entryTime: string;
  exitTime: string;
  side: 'long';
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnl: number;
  won: boolean;
}

export interface StrategyLabBacktestResult {
  status: 'insufficient_data' | 'complete';
  metrics: {
    totalReturnPct: number;
    winRate: number;
    profitFactor: number;
    sharpe: number;
    maxDrawdownPct: number;
    totalTrades: number;
    avgWinPct: number;
    avgLossPct: number;
    finalEquity: number;
  };
  equityCurve: Array<{ time: string; equity: number }>;
  trades: StrategyLabBacktestTrade[];
}

function round(value: number, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function calculateRsi(values: number[], length: number) {
  const rsi = new Array<number | null>(values.length).fill(null);
  if (values.length <= length) return rsi;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= length; index += 1) {
    const delta = values[index] - values[index - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;
  rsi[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let index = length + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    avgGain = (avgGain * (length - 1) + Math.max(delta, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-delta, 0)) / length;
    rsi[index] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

function calculateEma(values: number[], length: number) {
  const out = new Array<number | null>(values.length).fill(null);
  if (values.length === 0) return out;
  const multiplier = 2 / (length + 1);
  let ema = values[0];
  out[0] = ema;

  for (let index = 1; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
    out[index] = ema;
  }

  return out;
}

function emptyMetrics(initialCapital: number) {
  return {
    totalReturnPct: 0,
    winRate: 0,
    profitFactor: 0,
    sharpe: 0,
    maxDrawdownPct: 0,
    totalTrades: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    finalEquity: initialCapital,
  };
}

export function runStrategyLabBacktest(input: {
  strategy: StrategyLabStrategyDefinition;
  bars: StrategyLabBar[];
  initialCapital?: number;
  commissionBps?: number;
}): StrategyLabBacktestResult {
  const strategy = createStrategyLabStrategyDefinition(input.strategy);
  const bars = input.bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
  const initialCapital = input.initialCapital || 10000;

  if (bars.length < Math.max(30, strategy.indicators.rsiLength + 2)) {
    return {
      status: 'insufficient_data',
      metrics: emptyMetrics(initialCapital),
      equityCurve: [],
      trades: [],
    };
  }

  const closes = bars.map((bar) => bar.close);
  const rsi = calculateRsi(closes, strategy.indicators.rsiLength);
  const emaShort = calculateEma(closes, strategy.indicators.emaShort);
  const trades: StrategyLabBacktestTrade[] = [];
  let inTrade = false;
  let entryPrice = 0;
  let entryIndex = 0;
  const stopLoss = strategy.risk.stopLossPct / 100;
  const takeProfit = strategy.risk.takeProfitPct / 100;

  for (let index = strategy.indicators.rsiLength + 1; index < closes.length; index += 1) {
    if (!inTrade) {
      const crossedOversold = rsi[index] != null && rsi[index - 1] != null && rsi[index - 1]! >= 30 && rsi[index]! < 30;
      if (crossedOversold && closes[index] > (emaShort[index] || 0)) {
        inTrade = true;
        entryPrice = closes[index];
        entryIndex = index;
      }
      continue;
    }

    const currentPrice = closes[index];
    const pnlFraction = (currentPrice - entryPrice) / entryPrice;
    const crossedOverbought = rsi[index] != null && rsi[index - 1] != null && rsi[index - 1]! < 70 && rsi[index]! >= 70;

    if (crossedOverbought || pnlFraction <= -stopLoss || pnlFraction >= takeProfit) {
      const pnlPct = pnlFraction * 100;
      trades.push({
        entryTime: bars[entryIndex].time,
        exitTime: bars[index].time,
        side: 'long',
        entryPrice,
        exitPrice: currentPrice,
        pnlPct: round(pnlPct, 4),
        pnl: round(initialCapital * pnlFraction, 2),
        won: pnlPct > 0,
      });
      inTrade = false;
    }
  }

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;
  const equityCurve = trades.map((trade) => {
    equity *= 1 + trade.pnlPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak === 0 ? 0 : ((peak - equity) / peak) * 100);
    return { time: trade.exitTime, equity: round(equity, 2) };
  });

  const wins = trades.filter((trade) => trade.won);
  const losses = trades.filter((trade) => !trade.won);
  const avgWinPct = wins.length ? wins.reduce((sum, trade) => sum + trade.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length ? losses.reduce((sum, trade) => sum + trade.pnlPct, 0) / losses.length : 0;
  const returns = trades.map((trade) => trade.pnlPct);
  const meanReturn = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / returns.length : 0;
  const stdDev = Math.sqrt(variance);

  return {
    status: 'complete',
    metrics: {
      totalReturnPct: round(((equity - initialCapital) / initialCapital) * 100, 4),
      winRate: trades.length ? round((wins.length / trades.length) * 100, 2) : 0,
      profitFactor: avgLossPct !== 0 ? round(Math.abs(avgWinPct / avgLossPct), 4) : wins.length ? 999 : 0,
      sharpe: stdDev !== 0 ? round((meanReturn / stdDev) * Math.sqrt(252), 4) : 0,
      maxDrawdownPct: round(maxDrawdownPct, 4),
      totalTrades: trades.length,
      avgWinPct: round(avgWinPct, 4),
      avgLossPct: round(avgLossPct, 4),
      finalEquity: round(equity, 2),
    },
    equityCurve,
    trades,
  };
}

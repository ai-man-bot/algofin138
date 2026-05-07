import { runStrategyLabBacktest } from './backtestEngine.ts';
import {
  createStrategyLabStrategyDefinition,
  type StrategyLabBar,
  type StrategyLabStrategyDefinition,
} from './strategyLabModels.ts';

export interface StrategyLabOptimizerRange {
  min: number;
  max: number;
  step: number;
}

export interface StrategyLabOptimizationResultRow {
  rsiLength: number;
  stopLossPct: number;
  takeProfitPct: number;
  totalReturnPct: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  maxDrawdownPct: number;
  totalTrades: number;
}

export function expandOptimizerRange(range: StrategyLabOptimizerRange) {
  if (!(range.step > 0)) {
    throw new Error('Optimizer range step must be greater than 0');
  }
  if (range.max < range.min) {
    throw new Error('Optimizer range max must be greater than or equal to min');
  }

  const values: number[] = [];
  for (let value = range.min; value <= range.max + 0.000001; value = Number((value + range.step).toFixed(8))) {
    values.push(Number(value.toFixed(4)));
  }
  return values;
}

export function runStrategyLabOptimization(input: {
  strategy: StrategyLabStrategyDefinition;
  bars: StrategyLabBar[];
  targetMetric: 'sharpe' | 'totalReturnPct' | 'winRate' | 'profitFactor';
  ranges: {
    rsiLength: StrategyLabOptimizerRange;
    stopLossPct: StrategyLabOptimizerRange;
    takeProfitPct: StrategyLabOptimizerRange;
  };
  maxCombinations?: number;
}) {
  const strategy = createStrategyLabStrategyDefinition(input.strategy);
  const rsiValues = expandOptimizerRange(input.ranges.rsiLength).map((value) => Math.floor(value));
  const stopLossValues = expandOptimizerRange(input.ranges.stopLossPct);
  const takeProfitValues = expandOptimizerRange(input.ranges.takeProfitPct);
  const totalCombinations = rsiValues.length * stopLossValues.length * takeProfitValues.length;
  const maxCombinations = input.maxCombinations || 500;

  if (totalCombinations > maxCombinations) {
    throw new Error(`Optimizer request ${totalCombinations} combinations exceeds maxCombinations ${maxCombinations}`);
  }

  const results: StrategyLabOptimizationResultRow[] = [];

  for (const rsiLength of rsiValues) {
    for (const stopLossPct of stopLossValues) {
      for (const takeProfitPct of takeProfitValues) {
        const backtest = runStrategyLabBacktest({
          strategy: {
            ...strategy,
            indicators: { ...strategy.indicators, rsiLength },
            risk: { ...strategy.risk, stopLossPct, takeProfitPct },
          },
          bars: input.bars,
        });

        results.push({
          rsiLength,
          stopLossPct,
          takeProfitPct,
          totalReturnPct: backtest.metrics.totalReturnPct,
          winRate: backtest.metrics.winRate,
          profitFactor: backtest.metrics.profitFactor,
          sharpe: backtest.metrics.sharpe,
          maxDrawdownPct: backtest.metrics.maxDrawdownPct,
          totalTrades: backtest.metrics.totalTrades,
        });
      }
    }
  }

  const targetMetric = input.targetMetric || 'sharpe';
  results.sort((a, b) => b[targetMetric] - a[targetMetric]);

  return {
    status: 'complete' as const,
    combinationsTested: totalCombinations,
    bestParams: results[0]
      ? {
          rsiLength: results[0].rsiLength,
          stopLossPct: results[0].stopLossPct,
          takeProfitPct: results[0].takeProfitPct,
        }
      : null,
    results,
  };
}

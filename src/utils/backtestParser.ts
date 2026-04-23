// Utility to parse TradingView Strategy Tester Excel export
import * as XLSX from 'xlsx';

export interface BacktestData {
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
}

// Helper function to parse values (handles formats like "2488.75" or "2,488.75 USD" or "248.87%")
const parseValue = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const str = String(val).replace(/,/g, '').replace(/USD/gi, '').trim();
  const match = str.match(/([+-]?[\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
};

const parsePercent = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const str = String(val);
  const match = str.match(/([+-]?[\d.]+)%/);
  return match ? parseFloat(match[1]) : 0;
};

export async function parseBacktestFile(file: File): Promise<BacktestData> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  
  // Initialize backtest data object
  const backtestData: BacktestData = {
    initialCapital: 0,
    netProfit: 0,
    netProfitPercent: 0,
    maxEquityDrawdown: 0,
    maxEquityDrawdownPercent: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    percentProfitable: 0,
    avgPnL: 0,
    avgWinningTrade: 0,
    avgLosingTrade: 0,
    ratioAvgWinLoss: 0,
    sharpeRatio: 0,
    profitFactor: 0,
    properties: {},
    fileName: file.name,
    uploadedAt: new Date().toISOString(),
  };

  // Parse each sheet
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    // Look for exact column names from TradingView export
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length < 2) continue;

      const label = String(row[0] || '').trim();
      const value = row[1];

      // Performance tab metrics
      if (label === 'Initial Capital') {
        backtestData.initialCapital = parseValue(value);
      } else if (label === 'Net profit') {
        backtestData.netProfit = parseValue(value);
        backtestData.netProfitPercent = parsePercent(value);
      } else if (label === 'Max equity drawdown') {
        backtestData.maxEquityDrawdown = parseValue(value);
        backtestData.maxEquityDrawdownPercent = parsePercent(value);
      }
      
      // Trades Analysis tab metrics
      else if (label === 'Total trades') {
        backtestData.totalTrades = parseValue(value);
      } else if (label === 'Winning trades') {
        backtestData.winningTrades = parseValue(value);
      } else if (label === 'Losing trades') {
        backtestData.losingTrades = parseValue(value);
      } else if (label === 'Percent profitable') {
        backtestData.percentProfitable = parsePercent(value);
      } else if (label === 'Avg P&L') {
        backtestData.avgPnL = parseValue(value);
      } else if (label === 'Avg winning trade') {
        backtestData.avgWinningTrade = parseValue(value);
      } else if (label === 'Avg losing trade') {
        backtestData.avgLosingTrade = parseValue(value);
      } else if (label === 'Ratio avg win / avg loss') {
        backtestData.ratioAvgWinLoss = parseValue(value);
      }
      
      // Additional metrics
      else if (label === 'Sharpe ratio') {
        backtestData.sharpeRatio = parseValue(value);
      } else if (label === 'Profit factor') {
        backtestData.profitFactor = parseValue(value);
      }
      
      // Store Properties tab data
      else if (sheetName.toLowerCase().includes('properties') || sheetName.toLowerCase().includes('property')) {
        backtestData.properties![label] = value;
      }
    }
  });

  // Validate that we got at least some data
  if (backtestData.totalTrades === 0 && backtestData.netProfit === 0) {
    throw new Error('Could not find valid backtest data in the file. Please ensure you uploaded a TradingView Strategy Tester export.');
  }

  return backtestData;
}

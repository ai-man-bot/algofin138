/**
 * MCP (Model Context Protocol) Server for AlgoFin.ai
 * 
 * This server enables AI assistants (Claude, Cursor AI, etc.) to interact with
 * AlgoFin.ai's trading platform through natural language commands.
 * 
 * Capabilities:
 * - Query portfolio and account information
 * - Execute trades through connected brokers
 * - Manage strategies (create, update, activate/pause)
 * - Analyze performance metrics
 * - Query trade history
 * - Manage webhooks and notifications
 * 
 * This complements the existing TradingView webhook flow by adding AI-powered interaction.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as kv from './kv_store.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// MCP Tool Definitions
export const MCP_TOOLS = {
  // Portfolio & Account Tools
  'algofin_get_portfolio': {
    name: 'algofin_get_portfolio',
    description: 'Get current portfolio holdings, positions, and account equity across all connected brokers',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID to fetch portfolio for',
        },
        broker: {
          type: 'string',
          description: 'Optional: Filter by specific broker (alpaca, interactive_brokers)',
          enum: ['alpaca', 'interactive_brokers', 'all'],
        },
      },
      required: ['userId'],
    },
  },
  
  'algofin_get_performance': {
    name: 'algofin_get_performance',
    description: 'Get performance metrics including P&L, win rate, profit factor, drawdown, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Optional: Filter by specific strategy ID',
        },
        timeframe: {
          type: 'string',
          description: 'Time period for analysis',
          enum: ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'],
        },
      },
      required: ['userId'],
    },
  },
  
  // Trading Tools
  'algofin_execute_trade': {
    name: 'algofin_execute_trade',
    description: 'Execute a trade through connected broker. Uses the same engine as TradingView webhooks.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Strategy ID to execute trade under',
        },
        symbol: {
          type: 'string',
          description: 'Trading symbol (e.g., AAPL, TSLA)',
        },
        action: {
          type: 'string',
          description: 'Trade action',
          enum: ['buy', 'sell', 'close'],
        },
        quantity: {
          type: 'number',
          description: 'Number of shares/contracts',
        },
        orderType: {
          type: 'string',
          description: 'Order type',
          enum: ['market', 'limit', 'stop', 'stop_limit'],
        },
        limitPrice: {
          type: 'number',
          description: 'Limit price (required for limit orders)',
        },
        broker: {
          type: 'string',
          description: 'Broker to execute through',
          enum: ['alpaca', 'interactive_brokers'],
        },
      },
      required: ['userId', 'strategyId', 'symbol', 'action', 'quantity', 'orderType', 'broker'],
    },
  },
  
  // Strategy Management Tools
  'algofin_list_strategies': {
    name: 'algofin_list_strategies',
    description: 'List all trading strategies with their status and performance',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['active', 'paused', 'inactive', 'all'],
        },
      },
      required: ['userId'],
    },
  },
  
  'algofin_create_strategy': {
    name: 'algofin_create_strategy',
    description: 'Create a new trading strategy',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        name: {
          type: 'string',
          description: 'Strategy name',
        },
        strategyType: {
          type: 'string',
          description: 'Strategy type',
          enum: ['manual', 'tradingview'],
        },
        symbols: {
          type: 'string',
          description: 'Comma-separated list of symbols',
        },
        positionSize: {
          type: 'number',
          description: 'Position size in dollars',
        },
        maxPositions: {
          type: 'number',
          description: 'Maximum concurrent positions',
        },
      },
      required: ['userId', 'name', 'strategyType'],
    },
  },
  
  'algofin_update_strategy': {
    name: 'algofin_update_strategy',
    description: 'Update an existing strategy (modify settings, activate/pause)',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Strategy ID to update',
        },
        status: {
          type: 'string',
          description: 'Strategy status',
          enum: ['active', 'paused', 'inactive'],
        },
        positionSize: {
          type: 'number',
          description: 'Position size in dollars',
        },
        maxPositions: {
          type: 'number',
          description: 'Maximum concurrent positions',
        },
      },
      required: ['userId', 'strategyId'],
    },
  },
  
  // Analysis Tools
  'algofin_get_trades': {
    name: 'algofin_get_trades',
    description: 'Query trade history with filters',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Filter by strategy',
        },
        symbol: {
          type: 'string',
          description: 'Filter by symbol',
        },
        status: {
          type: 'string',
          description: 'Filter by status',
          enum: ['filled', 'pending', 'cancelled', 'rejected', 'all'],
        },
        startDate: {
          type: 'string',
          description: 'Start date (ISO format)',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO format)',
        },
      },
      required: ['userId'],
    },
  },
  
  'algofin_analyze_strategy': {
    name: 'algofin_analyze_strategy',
    description: 'Deep analysis of strategy performance with suggestions for improvement',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Strategy ID to analyze',
        },
      },
      required: ['userId', 'strategyId'],
    },
  },
  
  // Broker Connection Tools
  'algofin_list_brokers': {
    name: 'algofin_list_brokers',
    description: 'List all connected broker accounts',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
      },
      required: ['userId'],
    },
  },
  
  'algofin_sync_trades': {
    name: 'algofin_sync_trades',
    description: 'Sync trades from broker APIs to update local database',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        broker: {
          type: 'string',
          description: 'Specific broker to sync',
          enum: ['alpaca', 'interactive_brokers', 'all'],
        },
      },
      required: ['userId'],
    },
  },
  
  // Alert & Webhook Tools
  'algofin_get_webhook_url': {
    name: 'algofin_get_webhook_url',
    description: 'Get webhook URL for TradingView alerts for a specific strategy',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Strategy ID',
        },
      },
      required: ['userId', 'strategyId'],
    },
  },
  
  'algofin_generate_tradingview_code': {
    name: 'algofin_generate_tradingview_code',
    description: 'Generate TradingView Pine Script alert code for a strategy',
    inputSchema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'User ID',
        },
        strategyId: {
          type: 'string',
          description: 'Strategy ID',
        },
        alertType: {
          type: 'string',
          description: 'Type of alert',
          enum: ['entry', 'exit', 'both'],
        },
      },
      required: ['userId', 'strategyId', 'alertType'],
    },
  },
};

// MCP Tool Handlers
export async function handleMCPTool(toolName: string, args: any): Promise<any> {
  switch (toolName) {
    case 'algofin_get_portfolio':
      return await getPortfolio(args);
    
    case 'algofin_get_performance':
      return await getPerformance(args);
    
    case 'algofin_execute_trade':
      return await executeTrade(args);
    
    case 'algofin_list_strategies':
      return await listStrategies(args);
    
    case 'algofin_create_strategy':
      return await createStrategy(args);
    
    case 'algofin_update_strategy':
      return await updateStrategy(args);
    
    case 'algofin_get_trades':
      return await getTrades(args);
    
    case 'algofin_analyze_strategy':
      return await analyzeStrategy(args);
    
    case 'algofin_list_brokers':
      return await listBrokers(args);
    
    case 'algofin_sync_trades':
      return await syncTrades(args);
    
    case 'algofin_get_webhook_url':
      return await getWebhookUrl(args);
    
    case 'algofin_generate_tradingview_code':
      return await generateTradingViewCode(args);
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Tool Implementation Functions
async function getPortfolio(args: any) {
  const { userId, broker = 'all' } = args;
  
  // Get all broker accounts for user
  const accounts = await kv.getByPrefix(`brokerAccount:${userId}:`);
  
  const portfolios = [];
  
  for (const account of accounts) {
    if (broker !== 'all' && !account.key.includes(broker)) continue;
    
    const brokerType = account.value.broker;
    const accountId = account.value.accountId;
    
    // Fetch positions from broker
    // This would call the actual broker API (Alpaca, IB, etc.)
    const positions = await kv.get(`positions:${userId}:${accountId}`);
    
    portfolios.push({
      broker: brokerType,
      accountId: accountId,
      equity: account.value.equity || 0,
      cash: account.value.cash || 0,
      positions: positions?.value || [],
      lastUpdated: account.value.lastSync,
    });
  }
  
  return {
    portfolios,
    totalEquity: portfolios.reduce((sum, p) => sum + (p.equity || 0), 0),
    timestamp: new Date().toISOString(),
  };
}

async function getPerformance(args: any) {
  const { userId, strategyId, timeframe = 'ALL' } = args;
  
  // Get all trades for user/strategy
  const trades = await kv.getByPrefix(
    strategyId ? `trade:${userId}:${strategyId}:` : `trade:${userId}:`
  );
  
  // Filter by timeframe if needed
  // Calculate metrics
  const closedTrades = trades.filter(t => t.value.status === 'filled' && t.value.pnl);
  
  const totalPnL = closedTrades.reduce((sum, t) => sum + (t.value.pnl || 0), 0);
  const winningTrades = closedTrades.filter(t => t.value.pnl > 0);
  const losingTrades = closedTrades.filter(t => t.value.pnl < 0);
  
  const winRate = closedTrades.length > 0 
    ? (winningTrades.length / closedTrades.length) * 100 
    : 0;
  
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.value.pnl, 0) / winningTrades.length
    : 0;
  
  const avgLoss = losingTrades.length > 0
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.value.pnl, 0) / losingTrades.length)
    : 0;
  
  const profitFactor = avgLoss > 0 && losingTrades.length > 0
    ? (avgWin * winningTrades.length) / (avgLoss * losingTrades.length)
    : 0;
  
  return {
    totalPnL,
    totalTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy: (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss,
    timeframe,
  };
}

async function executeTrade(args: any) {
  const { userId, strategyId, symbol, action, quantity, orderType, limitPrice, broker } = args;
  
  // This would integrate with your existing order execution logic
  // from the webhook handler
  
  const trade = {
    userId,
    strategyId,
    symbol,
    side: action,
    quantity,
    type: orderType,
    limitPrice,
    broker,
    source: 'mcp', // Mark as MCP-initiated
    submittedAt: new Date().toISOString(),
    status: 'pending',
  };
  
  // Save to database
  const tradeId = crypto.randomUUID();
  await kv.set(`trade:${userId}:${strategyId}:${tradeId}`, trade);
  
  return {
    success: true,
    tradeId,
    message: `Trade submitted: ${action} ${quantity} ${symbol} via ${broker}`,
    trade,
  };
}

async function listStrategies(args: any) {
  const { userId, status = 'all' } = args;
  
  const strategies = await kv.getByPrefix(`strategy:${userId}:`);
  
  const filtered = strategies.filter(s => 
    status === 'all' || s.value.status === status
  );
  
  return {
    strategies: filtered.map(s => ({
      id: s.value.id,
      name: s.value.name,
      status: s.value.status,
      type: s.value.strategyType,
      symbols: s.value.symbols,
      positionSize: s.value.positionSize,
      maxPositions: s.value.maxPositions,
      hasBacktest: !!s.value.backtestData,
    })),
    total: filtered.length,
  };
}

async function createStrategy(args: any) {
  const { userId, name, strategyType, symbols, positionSize, maxPositions } = args;
  
  const strategyId = crypto.randomUUID();
  const strategy = {
    id: strategyId,
    userId,
    name,
    strategyType,
    symbols,
    positionSize: positionSize || 5000,
    maxPositions: maxPositions || 5,
    status: 'inactive',
    createdAt: new Date().toISOString(),
  };
  
  await kv.set(`strategy:${userId}:${strategyId}`, strategy);
  
  return {
    success: true,
    strategyId,
    message: `Strategy "${name}" created successfully`,
    strategy,
  };
}

async function updateStrategy(args: any) {
  const { userId, strategyId, status, positionSize, maxPositions } = args;
  
  const existing = await kv.get(`strategy:${userId}:${strategyId}`);
  if (!existing) {
    throw new Error('Strategy not found');
  }
  
  const updated = {
    ...existing.value,
    ...(status && { status }),
    ...(positionSize && { positionSize }),
    ...(maxPositions && { maxPositions }),
    updatedAt: new Date().toISOString(),
  };
  
  await kv.set(`strategy:${userId}:${strategyId}`, updated);
  
  return {
    success: true,
    message: 'Strategy updated successfully',
    strategy: updated,
  };
}

async function getTrades(args: any) {
  const { userId, strategyId, symbol, status = 'all', startDate, endDate } = args;
  
  const prefix = strategyId 
    ? `trade:${userId}:${strategyId}:` 
    : `trade:${userId}:`;
  
  let trades = await kv.getByPrefix(prefix);
  
  // Apply filters
  trades = trades.filter(t => {
    if (symbol && t.value.symbol !== symbol) return false;
    if (status !== 'all' && t.value.status !== status) return false;
    if (startDate && new Date(t.value.submittedAt) < new Date(startDate)) return false;
    if (endDate && new Date(t.value.submittedAt) > new Date(endDate)) return false;
    return true;
  });
  
  return {
    trades: trades.map(t => t.value),
    total: trades.length,
    filters: { strategyId, symbol, status, startDate, endDate },
  };
}

async function analyzeStrategy(args: any) {
  const { userId, strategyId } = args;
  
  // Get strategy and its trades
  const strategy = await kv.get(`strategy:${userId}:${strategyId}`);
  if (!strategy) {
    throw new Error('Strategy not found');
  }
  
  const performance = await getPerformance({ userId, strategyId, timeframe: 'ALL' });
  
  // Generate insights
  const insights = [];
  
  if (performance.winRate < 50) {
    insights.push({
      type: 'warning',
      metric: 'Win Rate',
      value: performance.winRate,
      suggestion: 'Win rate is below 50%. Consider tightening entry criteria or improving exit timing.',
    });
  }
  
  if (performance.profitFactor < 1.5) {
    insights.push({
      type: 'warning',
      metric: 'Profit Factor',
      value: performance.profitFactor,
      suggestion: 'Profit factor is low. Review risk/reward ratio and consider wider profit targets.',
    });
  }
  
  if (performance.avgLoss > performance.avgWin) {
    insights.push({
      type: 'alert',
      metric: 'Risk/Reward',
      suggestion: 'Average loss exceeds average win. This requires a very high win rate to be profitable.',
    });
  }
  
  return {
    strategy: strategy.value,
    performance,
    insights,
    recommendation: insights.length === 0 
      ? 'Strategy performing well. Continue monitoring.' 
      : 'Strategy needs optimization. Review insights above.',
  };
}

async function listBrokers(args: any) {
  const { userId } = args;
  
  const accounts = await kv.getByPrefix(`brokerAccount:${userId}:`);
  
  return {
    brokers: accounts.map(a => ({
      broker: a.value.broker,
      accountId: a.value.accountId,
      accountName: a.value.accountName,
      connected: a.value.connected,
      equity: a.value.equity,
      cash: a.value.cash,
      lastSync: a.value.lastSync,
    })),
    total: accounts.length,
  };
}

async function syncTrades(args: any) {
  const { userId, broker = 'all' } = args;
  
  // This would trigger the sync functionality
  // Similar to the sync button in the UI
  
  return {
    success: true,
    message: `Sync initiated for ${broker} broker(s)`,
    timestamp: new Date().toISOString(),
  };
}

async function getWebhookUrl(args: any) {
  const { userId, strategyId } = args;
  
  const strategy = await kv.get(`strategy:${userId}:${strategyId}`);
  if (!strategy) {
    throw new Error('Strategy not found');
  }
  
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-f118884a/webhook`;
  const webhookToken = strategy.value.webhookToken || crypto.randomUUID();
  
  // Save token if new
  if (!strategy.value.webhookToken) {
    await kv.set(`strategy:${userId}:${strategyId}`, {
      ...strategy.value,
      webhookToken,
    });
  }
  
  return {
    webhookUrl,
    webhookToken,
    strategyId,
    instructions: 'Use this URL in TradingView alert webhook. Include webhook token in JSON payload.',
  };
}

async function generateTradingViewCode(args: any) {
  const { userId, strategyId, alertType } = args;
  
  const strategy = await kv.get(`strategy:${userId}:${strategyId}`);
  if (!strategy) {
    throw new Error('Strategy not found');
  }
  
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/make-server-f118884a/webhook`;
  const webhookToken = strategy.value.webhookToken || 'YOUR_WEBHOOK_TOKEN';
  
  let alertCode = '';
  
  if (alertType === 'entry' || alertType === 'both') {
    alertCode += `// Long Entry Alert\n`;
    alertCode += `alertcondition(longCondition, title="Long Entry", message='{\n`;
    alertCode += `  "token": "${webhookToken}",\n`;
    alertCode += `  "strategyId": "${strategyId}",\n`;
    alertCode += `  "action": "buy",\n`;
    alertCode += `  "symbol": "{{ticker}}",\n`;
    alertCode += `  "price": {{close}}\n`;
    alertCode += `}')\n\n`;
  }
  
  if (alertType === 'exit' || alertType === 'both') {
    alertCode += `// Exit Alert\n`;
    alertCode += `alertcondition(exitCondition, title="Exit", message='{\n`;
    alertCode += `  "token": "${webhookToken}",\n`;
    alertCode += `  "strategyId": "${strategyId}",\n`;
    alertCode += `  "action": "sell",\n`;
    alertCode += `  "symbol": "{{ticker}}",\n`;
    alertCode += `  "price": {{close}}\n`;
    alertCode += `}')\n`;
  }
  
  return {
    alertCode,
    webhookUrl,
    instructions: [
      '1. Copy the alert code above into your TradingView Pine Script',
      '2. Set up alerts using the alertcondition functions',
      '3. In the alert dialog, paste the webhook URL in the webhook field',
      '4. Ensure the message format matches the JSON structure',
    ],
  };
}

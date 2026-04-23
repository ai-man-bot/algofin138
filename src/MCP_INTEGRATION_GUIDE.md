# AlgoFin.ai MCP Server Integration Guide

## Overview

AlgoFin.ai now includes a **Model Context Protocol (MCP)** server implementation, similar to Alpaca's MCP server. This enables AI assistants like Claude, Cursor AI, and other MCP-compatible tools to interact with your trading platform through natural language commands.

## What is MCP?

Model Context Protocol (MCP) is a standardized protocol that allows AI assistants to interact with external services and tools. It provides:

- **Natural Language Interface**: Control your trading platform using conversational commands
- **AI-Powered Analysis**: Get intelligent insights and recommendations
- **Code Generation**: Generate TradingView Pine Script and alert configurations
- **Automated Workflows**: Chain multiple operations together seamlessly

## Architecture

```
┌─────────────────┐
│  AI Assistant   │  (Claude, Cursor AI, etc.)
│  (MCP Client)   │
└────────┬────────┘
         │ MCP Protocol
         ▼
┌─────────────────────────────────────┐
│   AlgoFin.ai MCP Server             │
│   /mcp/tools, /mcp/execute          │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│   AlgoFin.ai Backend                │
│   (Strategies, Trades, Brokers)     │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│   Broker APIs                        │
│   (Alpaca, Interactive Brokers)     │
└─────────────────────────────────────┘
```

## How It Complements TradingView Webhooks

**Current Flow (Automated Trading):**
```
TradingView Alert → Webhook → AlgoFin.ai → Broker API → Execute Trade
```

**New MCP Flow (AI-Assisted Management):**
```
Natural Language → AI Assistant → MCP Server → AlgoFin.ai → Action
```

### Use Cases

1. **TradingView Webhooks**: Automated trade execution based on technical indicators
2. **MCP Server**: 
   - Create and manage strategies via AI
   - Analyze performance and get recommendations
   - Generate TradingView alert code automatically
   - Monitor portfolio and get insights
   - Execute manual trades with natural language
   - Troubleshoot and optimize strategies

## Available MCP Tools

### Portfolio & Account Management

#### `algofin_get_portfolio`
Get current portfolio holdings and equity across all connected brokers.

**Example Prompt:**
> "Show me my current portfolio"

**Parameters:**
- `userId` (required): User ID
- `broker` (optional): Filter by specific broker (alpaca, interactive_brokers, all)

**Returns:**
```json
{
  "portfolios": [
    {
      "broker": "alpaca",
      "accountId": "XXXXXX",
      "equity": 125430.50,
      "cash": 25430.50,
      "positions": [...],
      "lastUpdated": "2025-12-25T10:30:00Z"
    }
  ],
  "totalEquity": 125430.50,
  "timestamp": "2025-12-25T10:30:00Z"
}
```

#### `algofin_get_performance`
Get performance metrics including P&L, win rate, profit factor, etc.

**Example Prompt:**
> "What's my strategy performance for the last month?"

**Parameters:**
- `userId` (required)
- `strategyId` (optional): Filter by specific strategy
- `timeframe` (optional): 1D, 1W, 1M, 3M, 6M, 1Y, ALL

**Returns:**
```json
{
  "totalPnL": 5432.10,
  "totalTrades": 45,
  "winningTrades": 28,
  "losingTrades": 17,
  "winRate": 62.22,
  "profitFactor": 1.85,
  "avgWin": 325.50,
  "avgLoss": 180.25,
  "expectancy": 120.71
}
```

### Trading Operations

#### `algofin_execute_trade`
Execute a trade through connected broker.

**Example Prompt:**
> "Buy 100 shares of AAPL at market price through Alpaca"

**Parameters:**
- `userId` (required)
- `strategyId` (required): Which strategy to execute under
- `symbol` (required): Trading symbol (e.g., AAPL, TSLA)
- `action` (required): buy, sell, close
- `quantity` (required): Number of shares
- `orderType` (required): market, limit, stop, stop_limit
- `limitPrice` (optional): Required for limit orders
- `broker` (required): alpaca, interactive_brokers

**Returns:**
```json
{
  "success": true,
  "tradeId": "uuid-here",
  "message": "Trade submitted: buy 100 AAPL via alpaca",
  "trade": { ... }
}
```

### Strategy Management

#### `algofin_list_strategies`
List all trading strategies with status.

**Example Prompt:**
> "Show me all my active strategies"

**Parameters:**
- `userId` (required)
- `status` (optional): active, paused, inactive, all

#### `algofin_create_strategy`
Create a new trading strategy.

**Example Prompt:**
> "Create a new strategy called 'Tech Momentum' for AAPL, TSLA, NVDA with $5000 position size"

**Parameters:**
- `userId` (required)
- `name` (required): Strategy name
- `strategyType` (required): manual, tradingview
- `symbols` (optional): Comma-separated list
- `positionSize` (optional): Position size in dollars
- `maxPositions` (optional): Max concurrent positions

#### `algofin_update_strategy`
Update an existing strategy.

**Example Prompt:**
> "Pause my Tech Momentum strategy"

**Parameters:**
- `userId` (required)
- `strategyId` (required)
- `status` (optional): active, paused, inactive
- `positionSize` (optional)
- `maxPositions` (optional)

### Analysis & Insights

#### `algofin_get_trades`
Query trade history with filters.

**Example Prompt:**
> "Show me all losing trades for TSLA this month"

**Parameters:**
- `userId` (required)
- `strategyId` (optional)
- `symbol` (optional)
- `status` (optional): filled, pending, cancelled, rejected, all
- `startDate` (optional): ISO format
- `endDate` (optional): ISO format

#### `algofin_analyze_strategy`
Deep analysis with AI-powered insights and recommendations.

**Example Prompt:**
> "Analyze my RSI strategy and tell me how to improve it"

**Parameters:**
- `userId` (required)
- `strategyId` (required)

**Returns:**
```json
{
  "strategy": { ... },
  "performance": { ... },
  "insights": [
    {
      "type": "warning",
      "metric": "Win Rate",
      "value": 45.2,
      "suggestion": "Win rate is below 50%. Consider tightening entry criteria..."
    }
  ],
  "recommendation": "Strategy needs optimization. Review insights above."
}
```

### Broker Integration

#### `algofin_list_brokers`
List all connected broker accounts.

**Example Prompt:**
> "Which brokers do I have connected?"

#### `algofin_sync_trades`
Sync trades from broker APIs.

**Example Prompt:**
> "Sync my Alpaca trades"

**Parameters:**
- `userId` (required)
- `broker` (optional): alpaca, interactive_brokers, all

### TradingView Integration

#### `algofin_get_webhook_url`
Get webhook URL for TradingView alerts.

**Example Prompt:**
> "Give me the webhook URL for my momentum strategy"

**Parameters:**
- `userId` (required)
- `strategyId` (required)

**Returns:**
```json
{
  "webhookUrl": "https://xxx.supabase.co/functions/v1/make-server-f118884a/webhook",
  "webhookToken": "your-secret-token",
  "strategyId": "strategy-id",
  "instructions": "Use this URL in TradingView alert webhook..."
}
```

#### `algofin_generate_tradingview_code`
Generate TradingView Pine Script alert code.

**Example Prompt:**
> "Generate TradingView alert code for my strategy entry and exit signals"

**Parameters:**
- `userId` (required)
- `strategyId` (required)
- `alertType` (required): entry, exit, both

**Returns:**
```json
{
  "alertCode": "// Pine Script code here...",
  "webhookUrl": "https://...",
  "instructions": [
    "1. Copy the alert code above...",
    "2. Set up alerts using...",
    ...
  ]
}
```

## Setting Up MCP Integration

### Option 1: Using Claude Desktop

1. **Install Claude Desktop** (if not already installed)

2. **Configure MCP Server** in Claude's config file:

**MacOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "algofin": {
      "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

3. **Restart Claude Desktop**

4. **Start chatting:**
   > "Show me my portfolio"
   > "Create a new momentum strategy for tech stocks"
   > "Analyze my best performing strategy this month"

### Option 2: Using Cursor AI

1. **Install Cursor AI** (if not already installed)

2. **Configure in Cursor settings** → MCP Servers:

```json
{
  "mcp": {
    "servers": {
      "algofin": {
        "url": "https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp/execute",
        "token": "YOUR_ACCESS_TOKEN"
      }
    }
  }
}
```

3. **Use in Cursor chat:**
   > "@algofin show my active strategies"
   > "@algofin buy 50 shares of NVDA using my momentum strategy"

### Option 3: Custom Integration

Use the REST API directly:

```bash
# List available tools
curl https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp/tools

# Execute a tool
curl -X POST https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp/execute \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "algofin_get_portfolio",
    "args": {
      "broker": "all"
    }
  }'
```

## Example AI Conversations

### Portfolio Management
```
You: "What's my total equity across all brokers?"
AI: "Your total equity is $125,430.50 across 2 broker accounts:
     - Alpaca: $95,200.25
     - Interactive Brokers: $30,230.25"

You: "Show me my current positions"
AI: "You have 8 open positions:
     1. AAPL - 50 shares @ $185.20 (+$420 unrealized)
     2. TSLA - 25 shares @ $245.80 (-$125 unrealized)
     ..."
```

### Strategy Analysis
```
You: "Analyze my RSI strategy and suggest improvements"
AI: "I analyzed your RSI strategy. Here are the findings:

     Performance:
     - Win Rate: 45.2% (Warning: Below 50%)
     - Profit Factor: 1.35 (Warning: Below recommended 1.5)
     - Total P&L: -$1,250

     Insights:
     1. Your average loss ($280) exceeds average win ($195)
     2. Win rate needs to be >60% to be profitable with this R/R
     
     Recommendations:
     1. Tighten stop losses to improve risk/reward
     2. Consider adding trend filter (only trade with trend)
     3. Increase profit targets to improve avg win
     
     Would you like me to generate a modified TradingView script?"
```

### Trade Execution
```
You: "Buy 100 shares of NVDA at market price through Alpaca under my momentum strategy"
AI: "Trade submitted successfully!
     - Symbol: NVDA
     - Quantity: 100 shares
     - Order Type: Market
     - Broker: Alpaca
     - Strategy: Momentum
     - Trade ID: abc-123-def
     
     The order has been sent to Alpaca and is pending execution."
```

### TradingView Integration
```
You: "Generate TradingView alert code for my breakout strategy"
AI: "Here's your TradingView alert code:

     ```pinescript
     // Long Entry Alert
     alertcondition(longCondition, title="Long Entry", message='{
       "token": "your-webhook-token",
       "strategyId": "breakout-123",
       "action": "buy",
       "symbol": "{{ticker}}",
       "price": {{close}}
     }')
     ```
     
     Setup instructions:
     1. Add this code to your Pine Script strategy
     2. Create an alert using the Long Entry condition
     3. Set webhook URL to: https://...
     4. The alert will automatically execute trades through AlgoFin.ai"
```

## Security Best Practices

1. **Authentication**: All MCP endpoints require valid Bearer token authentication
2. **Rate Limiting**: Consider implementing rate limits for MCP endpoints
3. **Audit Logging**: All MCP tool executions are logged with timestamps
4. **Scoped Permissions**: Tools only access data for authenticated user
5. **Trade Validation**: All trades go through same validation as webhook trades

## Benefits Over Traditional Approach

| Feature | TradingView Webhook | MCP Server |
|---------|-------------------|------------|
| **Automated Trading** | ✅ Excellent | ❌ Not designed for this |
| **Strategy Creation** | ⚠️ Manual coding | ✅ AI-assisted |
| **Performance Analysis** | ❌ Separate tools | ✅ Built-in AI analysis |
| **Code Generation** | ⚠️ Manual | ✅ Automated |
| **Portfolio Monitoring** | ❌ No | ✅ Natural language queries |
| **Debugging** | ⚠️ Manual | ✅ AI-assisted |
| **Learning Curve** | ⚠️ Steep | ✅ Conversational |

## Recommended Workflow

1. **Use TradingView Webhooks** for:
   - Automated strategy execution
   - High-frequency trading signals
   - Backtested, proven strategies
   - 24/7 automated trading

2. **Use MCP Server** for:
   - Creating new strategies
   - Analyzing performance
   - Generating TradingView code
   - Portfolio monitoring
   - Manual trade execution
   - Strategy optimization
   - Learning and experimentation

## Next Steps

1. **Configure Your MCP Client** (Claude Desktop or Cursor AI)
2. **Get Your Access Token** from AlgoFin.ai settings
3. **Test the Connection** with simple queries
4. **Explore AI-Powered Trading** management

## API Reference

### Base URL
```
https://YOUR_PROJECT_ID.supabase.co/functions/v1/make-server-f118884a/mcp
```

### Endpoints

- **GET** `/tools` - List all available MCP tools
- **POST** `/execute` - Execute an MCP tool
- **GET** `/info` - Server information and capabilities

### Authentication
All requests require Bearer token in Authorization header:
```
Authorization: Bearer YOUR_ACCESS_TOKEN
```

## Troubleshooting

### Tool Not Found
- Verify tool name matches exactly (e.g., `algofin_get_portfolio`)
- Check available tools: GET `/mcp/tools`

### Authentication Failed
- Verify access token is valid
- Check token has not expired
- Ensure Authorization header is correctly formatted

### Tool Execution Error
- Check all required parameters are provided
- Verify parameter types match schema
- Review server logs for detailed error messages

## Support

For issues or questions about MCP integration:
1. Check server logs in Supabase Edge Functions
2. Review this documentation
3. Test tools individually via REST API
4. Check AI assistant configuration

---

**Powered by AlgoFin.ai** | Model Context Protocol v1.0.0

/**
 * Seed Data Utility
 * 
 * This file contains helper functions to populate your AlgoFin.ai database
 * with realistic sample data for testing and demo purposes.
 * 
 * Usage: Call these functions from your browser console after logging in.
 */

import { strategiesAPI, tradesAPI, webhooksAPI, notificationsAPI } from './api';

// Seed strategies
export async function seedStrategies() {
  const strategies = [
    {
      name: 'Mean Reversion Alpha',
      status: 'active',
      performance: 12.4,
      trades: 247,
      winRate: 68.5,
      capital: 50000,
      entrySignal: 'RSI Oversold',
      exitSignal: 'Take Profit 3%',
      positionSize: 5000,
      maxPositions: 5,
      riskPerTrade: '2%',
      symbols: 'AAPL, MSFT, GOOGL, TSLA, NVDA',
    },
    {
      name: 'Momentum Breakout',
      status: 'active',
      performance: 8.7,
      trades: 183,
      winRate: 62.3,
      capital: 35000,
      entrySignal: 'MACD Cross',
      exitSignal: 'Trailing Stop',
      positionSize: 3500,
      maxPositions: 10,
      riskPerTrade: '1.5%',
      symbols: 'SPY, QQQ, IWM',
    },
    {
      name: 'Statistical Arbitrage',
      status: 'paused',
      performance: 15.2,
      trades: 412,
      winRate: 71.8,
      capital: 75000,
      entrySignal: 'Bollinger Band Touch',
      exitSignal: 'Mean Reversion',
      positionSize: 7500,
      maxPositions: 8,
      riskPerTrade: '1%',
      symbols: 'AAPL, MSFT, META, AMZN',
    },
  ];

  for (const strategy of strategies) {
    try {
      await strategiesAPI.create(strategy);
      console.log(`Created strategy: ${strategy.name}`);
    } catch (error) {
      console.error(`Error creating strategy ${strategy.name}:`, error);
    }
  }
  
  console.log('✅ Strategies seeded successfully!');
}

// Seed trades
export async function seedTrades() {
  const trades = [
    {
      date: '2024-12-05',
      time: '14:32:18',
      symbol: 'AAPL',
      side: 'BUY',
      qty: 150,
      price: 175.20,
      status: 'FILLED',
      profit: 468.00,
    },
    {
      date: '2024-12-05',
      time: '13:15:42',
      symbol: 'TSLA',
      side: 'SELL',
      qty: 80,
      price: 246.50,
      status: 'FILLED',
      profit: -292.80,
    },
    {
      date: '2024-12-05',
      time: '11:48:33',
      symbol: 'NVDA',
      side: 'BUY',
      qty: 100,
      price: 482.40,
      status: 'FILLED',
      profit: 1282.00,
    },
    {
      date: '2024-12-04',
      time: '15:45:12',
      symbol: 'MSFT',
      side: 'BUY',
      qty: 120,
      price: 370.80,
      status: 'FILLED',
      profit: 453.60,
    },
    {
      date: '2024-12-04',
      time: '14:22:55',
      symbol: 'GOOGL',
      side: 'SELL',
      qty: 200,
      price: 139.20,
      status: 'FILLED',
      profit: 346.00,
    },
  ];

  for (const trade of trades) {
    try {
      await tradesAPI.create(trade);
      console.log(`Created trade: ${trade.side} ${trade.qty} ${trade.symbol}`);
    } catch (error) {
      console.error(`Error creating trade:`, error);
    }
  }
  
  console.log('✅ Trades seeded successfully!');
}

// Seed webhooks
export async function seedWebhooks() {
  const webhooks = [
    {
      name: 'TradingView Long Signal',
      strategyId: 'strategy-1',
      status: 'active',
    },
    {
      name: 'TradingView Short Signal',
      strategyId: 'strategy-2',
      status: 'active',
    },
  ];

  for (const webhook of webhooks) {
    try {
      const result = await webhooksAPI.create(webhook);
      console.log(`Created webhook: ${webhook.name}`);
      console.log(`Webhook URL: ${result.url || 'Check server response'}`);
    } catch (error) {
      console.error(`Error creating webhook ${webhook.name}:`, error);
    }
  }
  
  console.log('✅ Webhooks seeded successfully!');
}

// Seed notifications
export async function seedNotifications() {
  const notifications = [
    {
      type: 'trade',
      title: 'Trade Executed',
      message: 'BUY order for 150 AAPL filled at $178.32',
      icon: 'TrendingUp',
      color: 'emerald',
    },
    {
      type: 'alert',
      title: 'Price Alert Triggered',
      message: 'TSLA reached your target price of $250.00',
      icon: 'Bell',
      color: 'blue',
    },
    {
      type: 'warning',
      title: 'Strategy Performance Warning',
      message: 'Mean Reversion Alpha drawdown exceeded 5%',
      icon: 'AlertTriangle',
      color: 'yellow',
    },
    {
      type: 'system',
      title: 'Daily P&L Report',
      message: 'Your portfolio is up +$3,420.80 (+2.25%) today',
      icon: 'DollarSign',
      color: 'emerald',
    },
  ];

  for (const notification of notifications) {
    try {
      await notificationsAPI.create(notification);
      console.log(`Created notification: ${notification.title}`);
    } catch (error) {
      console.error(`Error creating notification:`, error);
    }
  }
  
  console.log('✅ Notifications seeded successfully!');
}

// Seed all data at once
export async function seedAll() {
  console.log('🌱 Starting database seeding...');
  
  await seedStrategies();
  await seedTrades();
  await seedWebhooks();
  await seedNotifications();
  
  console.log('🎉 All data seeded successfully! Refresh your pages to see the data.');
}

// Make functions available in browser console
if (typeof window !== 'undefined') {
  (window as any).seedData = {
    seedAll,
    seedStrategies,
    seedTrades,
    seedWebhooks,
    seedNotifications,
  };
  
  console.log('💡 Seed data functions available! Use window.seedData.seedAll() to populate your database.');
}

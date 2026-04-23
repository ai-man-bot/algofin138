# 🚀 AlgoFin.ai Quick Start Guide

## Get Up and Running in 3 Minutes!

### 1️⃣ Create Your Account (30 seconds)

1. Open the app
2. Click **"Sign Up"**
3. Enter:
   - Name: `Alex Chen` (or your name)
   - Email: `demo@algofin.ai` (or your email)
   - Password: `password123` (or your password)
4. Click **"Create Account"**

✅ You're now logged in!

---

### 2️⃣ Seed Demo Data (30 seconds)

Open your browser console (Press `F12` or right-click → Inspect → Console)

Paste and run:
```javascript
window.seedData.seedAll()
```

You should see:
```
🌱 Starting database seeding...
✅ Strategies seeded successfully!
✅ Trades seeded successfully!
✅ Webhooks seeded successfully!
✅ Notifications seeded successfully!
🎉 All data seeded successfully! Refresh your pages to see the data.
```

**Refresh the page** to see your data!

---

### 3️⃣ Explore Your Dashboard (2 minutes)

Now you can explore all the features:

#### **Dashboard Tab**
- View your portfolio metrics ($152K equity, $78K buying power)
- See your equity curve (12-month performance)
- Monitor active positions (AAPL, TSLA, NVDA, etc.)
- Watch the live trading feed

#### **Strategy Tab**
- 3 pre-configured strategies:
  - Mean Reversion Alpha (Active, +12.4%)
  - Momentum Breakout (Active, +8.7%)
  - Statistical Arbitrage (Paused, +15.2%)
- Configure entry/exit signals
- Adjust position sizing and risk parameters
- View performance metrics

#### **Trades Tab**
- Complete trade history with sparkline trends
- Filter and search trades
- Export to CSV
- See profit/loss for each trade

#### **Webhooks Tab**
- Pre-configured TradingView webhooks
- Copy webhook URLs for external integrations
- View event logs and success rates

#### **Brokers Tab**
- Connect to Alpaca (already connected in demo)
- Add Interactive Brokers or TD Ameritrade
- Manage API keys and credentials

#### **Notifications Tab**
- Recent notifications feed
- Configure email, push, and SMS alerts
- Set quiet hours
- Manage alert types

---

## 🎯 Common Use Cases

### Creating a New Strategy

1. Go to **Strategy** tab
2. Click **"Deploy New Strategy"** (button coming soon)
3. Or use the console:
```javascript
const { strategiesAPI } = window;
await strategiesAPI.create({
  name: 'My Custom Strategy',
  status: 'active',
  performance: 0,
  trades: 0,
  winRate: 0,
  capital: 10000,
  entrySignal: 'Custom Signal',
  exitSignal: 'Custom Exit',
});
```

### Recording a New Trade

```javascript
const { tradesAPI } = window;
await tradesAPI.create({
  date: '2024-12-05',
  time: '15:30:00',
  symbol: 'AAPL',
  side: 'BUY',
  qty: 100,
  price: 178.50,
  status: 'FILLED',
  profit: 250.00,
});
```

### Creating a Webhook for TradingView

1. Go to **Webhooks** tab
2. Click **"Create Webhook"**
3. Enter name: `My TradingView Strategy`
4. Select a strategy
5. Copy the generated URL
6. In TradingView:
   - Create an alert
   - Paste the webhook URL
   - Use this message format:
   ```json
   {
     "action": "{{strategy.order.action}}",
     "symbol": "{{ticker}}",
     "qty": {{strategy.order.contracts}},
     "price": {{close}}
   }
   ```

---

## 💡 Pro Tips

### Viewing All Your Data

Open console and run:
```javascript
// View your strategies
const { strategiesAPI } = window;
const strategies = await strategiesAPI.getAll();
console.table(strategies);

// View your trades
const { tradesAPI } = window;
const trades = await tradesAPI.getAll();
console.table(trades);

// View your webhooks
const { webhooksAPI } = window;
const webhooks = await webhooksAPI.getAll();
console.table(webhooks);
```

### Updating a Strategy

```javascript
// First, get the strategy ID from the list above
await strategiesAPI.update('strategy-id-here', {
  status: 'paused',
  performance: 15.5,
});
```

### Creating Notifications

```javascript
const { notificationsAPI } = window;
await notificationsAPI.create({
  type: 'trade',
  title: 'New Trade Executed',
  message: 'BUY 100 AAPL at $178.50',
  icon: 'TrendingUp',
  color: 'emerald',
});
```

---

## 🔧 Troubleshooting

### "Unauthorized" errors?
- Make sure you're logged in
- Try logging out and back in
- Check browser console for details

### Data not showing?
- Refresh the page after seeding
- Check browser console for API errors
- Verify you ran `seedData.seedAll()`

### Google Sign-In not working?
- This requires additional Supabase configuration
- Use email/password login instead
- See BACKEND_SETUP.md for Google OAuth setup

---

## 📚 Learn More

- **Full Backend Documentation**: See `BACKEND_SETUP.md`
- **API Reference**: Check `/utils/api.ts`
- **Seed Data Examples**: Check `/utils/seedData.ts`
- **Server Code**: Check `/supabase/functions/server/index.tsx`

---

## 🎉 You're Ready!

Your AlgoFin.ai trading dashboard currently includes:
- ✅ Real user authentication
- ✅ Persistent database storage
- ✅ Complete API for all features
- ✅ Demo data to explore
- ✅ Webhook integrations
- ✅ Professional UI/UX

**Happy Trading!** 📈🚀

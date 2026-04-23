# AlgoFin.ai Backend Setup Guide

## 🎉 Backend is Ready!

Your AlgoFin.ai trading dashboard has a working Supabase backend scaffold with:

- ✅ **PostgreSQL Database** - Using flexible key-value store for all data
- ✅ **User Authentication** - Email/password and Google OAuth support
- ✅ **REST API** - Complete endpoints for all features
- ✅ **Real-time Data** - Dashboard metrics, trades, strategies, webhooks, and notifications

---

## 📋 What's Been Set Up

### 1. **Authentication System**
- Email/password sign up and login
- Google OAuth integration (requires additional setup - see below)
- Session management with JWT tokens
- Protected API routes

### 2. **Database Structure** (Key-Value Store)

All data is stored in the `kv_store_f118884a` table with the following key patterns:

```
user:{userId}:profile              → User profile data
user:{userId}:metrics              → Dashboard metrics
user:{userId}:equity-curve         → Portfolio performance data
user:{userId}:position:{id}        → Active trading positions
user:{userId}:trade:{id}           → Trade history
user:{userId}:strategy:{id}        → Trading strategies
user:{userId}:webhook:{id}         → Webhook configurations
user:{userId}:webhook-event:{id}   → Webhook event logs
user:{userId}:notification:{id}    → User notifications
user:{userId}:notification-preferences → Notification settings
user:{userId}:broker:{id}          → Broker connections
webhook-token:{token}              → Webhook token lookup
```

### 3. **API Endpoints**

**Authentication:**
- `POST /auth/signup` - Create new user account

**Dashboard:**
- `GET /dashboard/metrics` - Get portfolio metrics
- `GET /dashboard/equity-curve` - Get equity curve data
- `GET /dashboard/positions` - Get active positions

**Trades:**
- `GET /trades` - Get all user trades
- `POST /trades` - Create new trade record

**Strategies:**
- `GET /strategies` - Get all strategies
- `POST /strategies` - Create new strategy
- `PUT /strategies/:id` - Update strategy
- `DELETE /strategies/:id` - Delete strategy

**Webhooks:**
- `GET /webhooks` - Get all webhooks
- `POST /webhooks` - Create new webhook
- `POST /webhook/:token` - Receive webhook event (public)
- `GET /webhooks/:id/events` - Get webhook events
- `DELETE /webhooks/:id` - Delete webhook

**Notifications:**
- `GET /notifications` - Get all notifications
- `POST /notifications` - Create notification
- `PUT /notifications/:id/read` - Mark as read
- `GET /notifications/preferences` - Get preferences
- `PUT /notifications/preferences` - Update preferences

**Brokers:**
- `GET /brokers` - Get connected brokers
- `POST /brokers` - Connect broker
- `DELETE /brokers/:id` - Disconnect broker

---

## 🚀 Getting Started

### Step 1: Create Your First Account

1. Click "Sign Up" on the login page
2. Enter your name, email, and password
3. Click "Create Account"
4. You'll be automatically logged in!

### Step 2: Populate Sample Data

After logging in, open your browser console (F12) and run:

```javascript
// Seed all data at once
window.seedData.seedAll()

// Or seed individually:
window.seedData.seedStrategies()
window.seedData.seedTrades()
window.seedData.seedWebhooks()
window.seedData.seedNotifications()
```

This will populate your database with realistic demo data!

### Step 3: Start Using the Platform

Navigate through the tabs:
- **Dashboard** - View portfolio metrics and active positions
- **Strategy** - Configure trading strategies
- **Trades** - View trade history
- **Webhooks** - Set up TradingView or other integrations
- **Brokers** - Connect your brokerage accounts
- **Notifications** - Manage alerts and preferences

---

## 🔐 Google OAuth Setup (Optional)

To enable Google sign-in, you need to configure it in Supabase:

1. Go to your Supabase project dashboard
2. Navigate to **Authentication → Providers**
3. Enable **Google** provider
4. Follow the guide: https://supabase.com/docs/guides/auth/social-login/auth-google
5. Add your Google OAuth credentials

Without this setup, Google sign-in will show an error (email/password will still work).

---

## 🔌 Webhook Integration

### How to Use Webhooks

1. **Create a webhook** in the Webhooks tab
2. **Copy the generated URL** (example: `https://{project}.supabase.co/functions/v1/make-server-f118884a/webhook-receiver?token={token}`)
3. **Configure in TradingView:**
   - Go to your TradingView alert
   - Set webhook URL to the copied URL
   - Set message format:
     ```json
     {
       "action": "{{strategy.order.action}}",
       "symbol": "{{ticker}}",
       "qty": {{strategy.order.contracts}},
       "price": {{close}}
     }
     ```
4. **Events are logged** in the webhook events table

---

## 💾 Data Persistence

All data is stored in Supabase and persists across sessions:

- User accounts and authentication
- Trading strategies and configurations
- Trade history and performance
- Webhook configurations and events
- Notifications and preferences
- Broker connections

**Important:** This is still prototype-grade storage. For production:
- Implement proper encryption for API keys
- Add data validation and sanitization
- Set up automated backups
- Implement rate limiting
- Add comprehensive error handling

---

## 🛠️ Development Notes

### Adding New Data

Use the API utility functions in `/utils/api.ts`:

```typescript
import { strategiesAPI, tradesAPI } from './utils/api';

// Create a new strategy
await strategiesAPI.create({
  name: 'My Strategy',
  status: 'active',
  // ... other fields
});

// Create a new trade
await tradesAPI.create({
  symbol: 'AAPL',
  side: 'BUY',
  qty: 100,
  price: 178.50,
  // ... other fields
});
```

### Accessing User Data

All API calls automatically include the user's authentication token. Data is scoped to the logged-in user via the `userId` in the key patterns.

### Server Code

The backend server code is in `/supabase/functions/server/index.tsx`. You can:
- Add new endpoints
- Modify existing routes
- Add business logic
- Integrate external APIs

---

## 📊 Database Schema Examples

### Strategy Record
```json
{
  "id": "uuid",
  "userId": "user-uuid",
  "name": "Mean Reversion Alpha",
  "status": "active",
  "performance": 12.4,
  "trades": 247,
  "winRate": 68.5,
  "capital": 50000,
  "createdAt": "2024-12-05T10:00:00Z"
}
```

### Trade Record
```json
{
  "id": "uuid",
  "userId": "user-uuid",
  "date": "2024-12-05",
  "time": "14:32:18",
  "symbol": "AAPL",
  "side": "BUY",
  "qty": 150,
  "price": 175.20,
  "status": "FILLED",
  "profit": 468.00,
  "createdAt": "2024-12-05T14:32:18Z"
}
```

### Webhook Record
```json
{
  "id": "uuid",
  "userId": "user-uuid",
  "name": "TradingView Long Signal",
  "token": "webhook-token-uuid",
  "url": "https://.../webhook/{token}",
  "status": "active",
  "triggers": 0,
  "successRate": 100,
  "createdAt": "2024-12-05T10:00:00Z"
}
```

---

## 🎯 Next Steps

Now that your backend is set up, you can:

1. ✅ Create user accounts and manage authentication
2. ✅ Store and retrieve real trading data
3. ✅ Set up webhook integrations with TradingView
4. ✅ Track strategies and performance metrics
5. ✅ Build out additional features as needed

**Ready to publish?** Your app now has real data persistence and is ready for testing!

---

## ⚠️ Important Security Notes

This is a **prototype/demo environment**:

- ✅ Great for testing and showcasing functionality
- ✅ User authentication is implemented
- ✅ Data is scoped per user
- ❌ NOT production-ready for real financial data
- ❌ API keys stored in plain text (encrypt in production)
- ❌ No rate limiting (add in production)
- ❌ Limited input validation (expand in production)

For production trading systems:
- Use proper secrets management
- Implement comprehensive security audits
- Add regulatory compliance features
- Use proper broker API SDKs with OAuth
- Implement transaction logging and audit trails

---

## 📚 Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [TradingView Webhooks](https://www.tradingview.com/support/solutions/43000529348-about-webhooks/)
- [Alpaca API Docs](https://alpaca.markets/docs/)

---

**Questions or Issues?**  
Check the browser console for detailed error messages and API responses.

Happy Trading! 🚀📈

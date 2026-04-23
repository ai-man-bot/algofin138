# AlgoFin.ai - Version History

## v0.2 - Complete Webhook Integration with Alpaca Trading (December 6, 2025)

### ✅ Fully Implemented Features

#### 1. **UI Structure (7 Main Screens)**
- **Login/Signup** - Google OAuth authentication via Supabase
- **Dashboard** - Real-time metrics and portfolio overview
- **Trades History** - Complete trade records display
- **Brokers Connection** - Alpaca & Interactive Brokers integration UI
- **Strategy Management** - Strategy creation and management
- **Webhooks Configuration** - Webhook URL generation and management
- **Notifications Settings** - Alert preferences

#### 2. **Design System**
- **Color Scheme:**
  - Dark slate: `#0f172a` (background)
  - Electric blue: `#3b82f6` (primary actions)
  - Emerald green: `#10b981` (success/buy)
  - Rose red: `#f43f5e` (error/sell)
- **Typography:**
  - Inter/Roboto for text
  - Monospace for numerical data
- **Dark theme throughout**

#### 3. **Backend Architecture (Supabase)**

##### **Single Edge Function Structure**
- **Location:** `/supabase/functions/server/index.tsx`
- **Important:** Figma Make supports ONLY ONE Edge Function
- **All routes prefixed with:** `/make-server-f118884a/`

##### **Public Endpoints (No Auth Required)**
```typescript
// Webhook receiver - validates with token parameter
POST /make-server-f118884a/webhook-receiver?token=<TOKEN>

// Health check
GET /make-server-f118884a/health

// Debug endpoints
GET /make-server-f118884a/test-webhook-token/:token
GET /make-server-f118884a/test-all-events
POST /make-server-f118884a/test-webhook
```

##### **Protected Endpoints (Require Authorization)**
```typescript
// User authentication
POST /make-server-f118884a/signup
POST /make-server-f118884a/login

// Webhooks management
GET /make-server-f118884a/webhooks
POST /make-server-f118884a/webhooks
DELETE /make-server-f118884a/webhooks/:webhookId
GET /make-server-f118884a/webhooks/:webhookId/events
GET /make-server-f118884a/webhooks/all/events

// Broker connections
POST /make-server-f118884a/brokers/alpaca/connect
POST /make-server-f118884a/brokers/alpaca/test
GET /make-server-f118884a/brokers/alpaca/account
POST /make-server-f118884a/brokers/alpaca/disconnect
```

#### 4. **Webhook Flow (TradingView → Database → Alpaca)**

##### **Step-by-Step Process:**

1. **Webhook URL Generation**
   - User creates webhook in UI
   - System generates unique token
   - URL format: `https://{projectId}.supabase.co/functions/v1/make-server-f118884a/webhook-receiver?token={uniqueToken}`
   - Token stored in KV database: `webhook-token:{token}` → `{userId, webhookId}`

2. **TradingView Alert Configuration**
   - User copies webhook URL to TradingView alert
   - TradingView sends POST with JSON payload:
     ```json
     {
       "action": "buy" | "sell",
       "symbol": "AAPL",
       "quantity": 100,
       "price": 150.25,
       "timestamp": "2025-12-06T19:44:55Z"
     }
     ```

3. **Webhook Receiver Processing**
   ```typescript
   // Extract token from query parameter
   const token = url.searchParams.get('token');
   
   // Validate token exists in database
   const tokenLookup = await kv.get(`webhook-token:${token}`);
   
   // Store event in database
   const eventId = crypto.randomUUID();
   await kv.set(
     `user:${userId}:webhook-event:${eventId}`,
     {
       webhookId,
       payload,
       receivedAt: new Date().toISOString(),
       status: 'received'
     }
   );
   ```

4. **Alpaca Trade Execution**
   ```typescript
   // Retrieve Alpaca credentials
   const broker = await kv.get(`user:${userId}:broker:alpaca`);
   
   // Place order via Alpaca API
   const order = await fetch('https://paper-api.alpaca.markets/v2/orders', {
     method: 'POST',
     headers: {
       'APCA-API-KEY-ID': broker.apiKey,
       'APCA-API-SECRET-KEY': broker.apiSecret,
     },
     body: JSON.stringify({
       symbol: payload.symbol,
       qty: payload.quantity,
       side: payload.action,
       type: 'market',
       time_in_force: 'gtc'
     })
   });
   
   // Update event with execution result
   await kv.set(`user:${userId}:webhook-event:${eventId}`, {
     ...event,
     status: 'executed',
     alpacaOrderId: order.id,
     executedAt: new Date().toISOString()
   });
   ```

#### 5. **Database Schema (Key-Value Store)**

```typescript
// User data
`user:${userId}:profile` → { email, name, createdAt }

// Broker connections
`user:${userId}:broker:alpaca` → { apiKey, apiSecret, connectedAt, accountInfo }
`user:${userId}:broker:interactivebrokers` → { ... }

// Webhooks
`user:${userId}:webhook:${webhookId}` → {
  id: string,
  name: string,
  token: string,
  createdAt: string,
  isActive: boolean
}

// Webhook token lookup (for fast validation)
`webhook-token:${token}` → { userId, webhookId }

// Webhook events
`user:${userId}:webhook-event:${eventId}` → {
  webhookId: string,
  payload: object,
  receivedAt: string,
  status: 'received' | 'executed' | 'failed',
  alpacaOrderId?: string,
  executedAt?: string,
  error?: string
}
```

#### 6. **Key Implementation Details**

##### **CORS Configuration**
```typescript
import { cors } from 'npm:hono/cors';
app.use('*', cors()); // Open CORS for all routes
```

##### **Logging**
```typescript
import { logger } from 'npm:hono/logger';
app.use('*', logger(console.log)); // All requests logged to Supabase dashboard
```

##### **Authentication Flow**
```typescript
// Frontend stores access token
const { data: { session: { access_token } } } = await supabase.auth.signInWithPassword({
  email, password
});

// Protected routes verify token
const accessToken = request.headers.get('Authorization')?.split(' ')[1];
const { data: { user: { id } } } = await supabase.auth.getUser(accessToken);
```

##### **Webhook Validation**
```typescript
// Token-based (not JWT-based) for external services
// This allows TradingView to POST without authentication header
const token = url.searchParams.get('token');
const webhookData = await kv.get(`webhook-token:${token}`);
if (!webhookData) {
  return c.json({ error: 'Invalid webhook token' }, 401);
}
```

#### 7. **Alpaca Integration**

##### **Connection Flow**
1. User enters API Key & Secret in UI
2. Frontend sends to `/brokers/alpaca/connect`
3. Backend tests connection with Alpaca API
4. Stores credentials in KV: `user:${userId}:broker:alpaca`
5. Returns account info to display in UI

##### **Order Execution**
- **API Endpoint:** `https://paper-api.alpaca.markets/v2/orders` (paper trading)
- **Production:** `https://api.alpaca.markets/v2/orders`
- **Authentication:** Headers with API key/secret
- **Order Types Supported:** Market orders with time_in_force: 'gtc'

#### 8. **File Structure**

```
/
├── App.tsx                                    # Main app with routing
├── components/
│   ├── LoginPage.tsx                         # Auth UI
│   ├── Dashboard.tsx                         # Main dashboard
│   ├── TradesTab.tsx                         # Trade history
│   ├── BrokersPage.tsx                       # Broker connections
│   ├── StrategyPage.tsx                      # Strategy management
│   ├── WebhooksPage.tsx                      # Webhook configuration
│   ├── NotificationsPage.tsx                 # Notifications settings
│   ├── WebhookDebugPage.tsx                  # Debug tools
│   └── ui/                                   # Reusable components
├── utils/
│   ├── api.ts                                # API client functions
│   └── supabase/
│       └── info.tsx                          # Supabase config (protected)
├── supabase/functions/server/
│   ├── index.tsx                             # SINGLE edge function (all routes)
│   └── kv_store.tsx                          # KV utilities (protected)
└── styles/
    └── globals.css                           # Tailwind + typography
```

#### 9. **Known Limitations**

1. **Single Edge Function Constraint**
   - Figma Make allows only ONE Edge Function
   - All routes must be in `/supabase/functions/server/index.tsx`
   - Cannot create separate functions like `/webhook-handler/`

2. **No Database Migrations**
   - Cannot run DDL statements or migrations
   - Must use existing KV table: `kv_store_f118884a`
   - Schema changes require manual Supabase UI updates

3. **Environment Variables**
   - Pre-configured: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
   - Custom env vars require `create_supabase_secret` tool

#### 10. **Testing & Debug Tools**

##### **Debug Page Features**
- Test webhook URL directly from browser
- Check database for stored events
- Verify webhook tokens
- Health check endpoint
- curl command generator

##### **Supabase Logs**
- Location: Supabase Dashboard → Logs → Edge Functions
- Filter by: `make-server-f118884a`
- Shows all console.log() output from server

#### 11. **Verified Working Flow**

✅ **End-to-End Test (December 6, 2025)**
1. Created webhook in UI → Generated token
2. Tested with "Test Webhook" button → 200 OK
3. Checked Supabase logs → Webhook receiver logs visible
4. Verified database → Events stored correctly
5. Checked Alpaca dashboard → Orders accepted and filled
6. Result: **3 AAPL market orders successfully executed**

#### 12. **Critical Troubleshooting Notes**

⚠️ **IMPORTANT: JWT Secret Configuration**

**Problem:** Webhooks stop working after deployment, POST requests return 401 Unauthorized

**Root Cause:** Supabase Edge Function has JWT verification enabled by default, which blocks public webhook endpoints that don't send JWT tokens in the Authorization header.

**Solution:**
1. Go to Supabase Dashboard
2. Navigate to: **Edge Functions** → **make-server-f118884a** → **Details**
3. Find setting: **"Verify JWT with legacy secret"**
4. **Toggle it OFF** (disable it)
5. Click **"Save changes"**

**Why This Happens:**
- TradingView and other external services POST webhooks without Supabase JWT tokens
- The `/webhook-receiver` endpoint uses token-based authentication (query parameter)
- When JWT verification is enabled, Supabase blocks all requests without valid JWT
- This prevents external webhooks from reaching the endpoint

**How to Identify This Issue:**
- Webhook activity log stops updating
- No POST requests in Supabase logs
- No "🚨 WEBHOOK POST REQUEST RECEIVED" logs
- TradingView shows successful sends, but nothing happens in AlgoFin.ai

**Prevention:**
- Document this in deployment checklist
- Always verify JWT setting after deploying Edge Functions
- Monitor Supabase logs for sudden absence of POST requests

**Reference:** Discovered December 6, 2025 at 8:16 PM when webhook activity stopped updating despite TradingView sending alerts every minute.

---

## v0.1 - Initial Alpaca Connection (Previous Version)

### Features
- Basic UI structure
- Alpaca API connection (real API)
- Simple authentication
- Dashboard with mock data

### Limitations
- Webhook handler was separate function (not supported)
- No webhook-to-trade execution flow
- Limited error handling

---

## Migration Notes (v0.1 → v0.2)

### Major Changes
1. **Consolidated Edge Function**
   - Moved webhook handler from `/webhook-handler/` to `/make-server-f118884a/webhook-receiver`
   - All routes now in single file

2. **Token-Based Webhook Auth**
   - Changed from JWT to query parameter token
   - Allows external services (TradingView) to POST without auth headers

3. **Complete Trade Execution Flow**
   - Added database event storage
   - Integrated Alpaca order placement
   - Added execution status tracking

4. **Enhanced Logging**
   - Step-by-step console logging
   - Detailed error messages
   - Supabase log integration

---

## Next Steps (Future Versions)

### v0.3 Potential Features
- Interactive Brokers integration
- Strategy backtesting
- Multiple webhook actions (stop-loss, take-profit)
- Position management (close, modify orders)
- Real-time notifications (email, SMS, push)
- Advanced order types (limit, stop, bracket)
- Paper trading mode toggle
- Webhook retry logic
- Rate limiting

### v1.0 Goals
- Production-ready deployment
- User onboarding flow
- Billing/subscription system
- Advanced analytics
- Mobile responsive design
- API rate limit handling
- Comprehensive error recovery

---

**Current Status:** v0.2 snapshot with a verified frontend build, active Supabase edge routes, and partially normalized live analytics.
**Last Updated:** December 6, 2025
**Tested:** Frontend build verified from this repo snapshot. Production status should be re-validated against the currently linked Supabase project before relying on it.

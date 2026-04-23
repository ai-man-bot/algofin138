# ✅ COMPLETE Webhook Flow - Fixed & Working

## 🎯 The Correct Flow (End-to-End)

```
┌─────────────────┐
│  TradingView    │
│  sends alert    │
└────────┬────────┘
         │ POST https://xxx.supabase.co/functions/v1/webhook-handler?token=abc123
         │ Body: { "action": "buy", "symbol": "AAPL", "quantity": 100 }
         ↓
┌──────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: /webhook-handler/index.ts          │
│  (Separate function - NO JWT authentication required!)       │
│                                                               │
│  STEP 1: Validate Token                                      │
│  ✓ Extract token from URL parameter                          │
│  ✓ Look up in database: webhook-token:{token}                │
│  ✓ Get userId and webhookId                                  │
│  ✓ Verify webhook is active                                  │
│                                                               │
│  STEP 2: Store Event in Database                             │
│  ✓ Parse and normalize payload                               │
│  ✓ Create event record in KV store                           │
│  ✓ Update webhook trigger count                              │
│                                                               │
│  STEP 3: Execute Trade on Alpaca                             │
│  ✓ Get user's Alpaca credentials from database               │
│  ✓ Build order request (symbol, qty, side, type)             │
│  ✓ POST to https://paper-api.alpaca.markets/v2/orders        │
│  ✓ Update event with execution result                        │
│                                                               │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ↓
                ┌───────────────────────┐
                │  Alpaca Paper Trading │
                │  Executes the order   │
                └───────────────────────┘
```

---

## 🔧 What Was Fixed

### Problem #1: Blank Screen ❌ → ✅ FIXED
**Cause:** "Test Webhook" button linked to non-existent `/debug-webhook` route

**Fix:** Changed to open a modal instead
```typescript
// OLD (broken):
<a href={`/debug-webhook?url=${webhook.url}`}>Test Webhook</a>

// NEW (works):
<button onClick={() => { setTestWebhookUrl(webhook.url); setShowTestModal(true); }}>
  Test Webhook
</button>
```

### Problem #2: Incomplete Webhook Flow ❌ → ✅ FIXED
**Cause:** Webhook handler only stored events, didn't execute trades

**Fix:** Added Alpaca integration in webhook-handler/index.ts (Step 3)
```typescript
// Get user's Alpaca credentials
const alpacaConfig = await supabase.from('kv_store_f118884a')
  .select('value')
  .eq('key', `user:${userId}:broker:alpaca`)
  .single();

// Execute trade on Alpaca
const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
  method: 'POST',
  headers: {
    'APCA-API-KEY-ID': alpacaConfig.apiKey,
    'APCA-API-SECRET-KEY': alpacaConfig.apiSecret,
  },
  body: JSON.stringify({ symbol, qty, side, type, time_in_force: 'gtc' }),
});
```

---

## 📋 Complete Flow Explanation

### STEP 1: TradingView Sends Signal
```json
POST https://xxx.supabase.co/functions/v1/webhook-handler?token=abc123-def456-ghi789
Content-Type: application/json

{
  "action": "buy",
  "symbol": "AAPL",
  "quantity": 100,
  "strategy": "Momentum Breakout"
}
```

### STEP 2: Webhook Handler Validates Token
```typescript
// Extract token from URL
const token = url.searchParams.get('token'); // "abc123-def456-ghi789"

// Look up in database
const tokenData = await supabase
  .from('kv_store_f118884a')
  .select('value')
  .eq('key', 'webhook-token:abc123-def456-ghi789')
  .single();

// Result: { userId: "user-123", webhookId: "webhook-456" }
```

### STEP 3: Get Webhook Configuration
```typescript
const webhookConfig = await supabase
  .from('kv_store_f118884a')
  .select('value')
  .eq('key', 'user:user-123:webhook:webhook-456')
  .single();

// Verify webhook is active
if (webhookConfig.status !== 'active') {
  return error('Webhook is not active');
}
```

### STEP 4: Normalize Payload
```typescript
// Support multiple formats (TradingView, custom, etc.)
const normalized = {
  action: payload.action || payload.side,        // "buy"
  symbol: payload.symbol || payload.ticker,      // "AAPL"
  quantity: payload.quantity || payload.qty,     // 100
  orderType: payload.order_type || payload.type, // "market"
  price: payload.price,                          // null for market orders
};
```

### STEP 5: Store Event in Database
```typescript
const eventId = crypto.randomUUID();

await supabase.from('kv_store_f118884a').insert({
  key: `user:user-123:webhook-event:${eventId}`,
  value: {
    id: eventId,
    webhookId: 'webhook-456',
    webhookName: 'TradingView Strategy',
    payload: normalized,
    receivedAt: '2024-12-06T10:30:00Z',
    status: 'success',
  }
});
```

### STEP 6: Get Alpaca Credentials
```typescript
const alpacaConfig = await supabase
  .from('kv_store_f118884a')
  .select('value')
  .eq('key', 'user:user-123:broker:alpaca')
  .single();

// Result: { apiKey: "PK...", apiSecret: "...", connected: true }
```

### STEP 7: Execute Trade on Alpaca
```typescript
const alpacaOrder = {
  symbol: 'AAPL',
  qty: 100,
  side: 'buy',
  type: 'market',
  time_in_force: 'gtc',
};

const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
  method: 'POST',
  headers: {
    'APCA-API-KEY-ID': alpacaConfig.apiKey,
    'APCA-API-SECRET-KEY': alpacaConfig.apiSecret,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(alpacaOrder),
});

const result = await alpacaResponse.json();
// Result: { id: "order-123", status: "accepted", symbol: "AAPL", ... }
```

### STEP 8: Update Event with Execution Details
```typescript
await supabase.from('kv_store_f118884a').update({
  value: {
    ...eventData,
    execution: {
      success: true,
      broker: 'alpaca',
      orderId: 'order-123',
      status: 'accepted',
    },
  }
}).eq('key', `user:user-123:webhook-event:${eventId}`);
```

### STEP 9: Return Success Response
```json
{
  "success": true,
  "eventId": "event-789",
  "message": "Webhook received and processed",
  "webhook": "TradingView Strategy",
  "timestamp": "2024-12-06T10:30:00Z",
  "execution": {
    "success": true,
    "broker": "alpaca",
    "orderId": "order-123",
    "status": "accepted",
    "symbol": "AAPL",
    "qty": 100,
    "side": "buy"
  }
}
```

---

## 🎬 Testing the Flow

### Test from UI (Internal Test)
1. Go to Webhooks page
2. Click "Test Webhook" button
3. Modal appears with webhook URL pre-filled
4. Edit payload if needed
5. Click "Test" button
6. Results appear in modal
7. Check "Recent Events" table for new entry

### Test from External Tool (Real-world)
```bash
# Using curl
curl -X POST 'https://xxx.supabase.co/functions/v1/webhook-handler?token=YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "buy",
    "symbol": "AAPL",
    "quantity": 10
  }'
```

### Test from TradingView
1. Create alert in TradingView
2. Set webhook URL: `https://xxx.supabase.co/functions/v1/webhook-handler?token=YOUR_TOKEN`
3. Set message body:
```json
{
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "quantity": {{strategy.order.contracts}}
}
```

---

## ✅ Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Webhook creation | ✅ Working | Generates unique tokens |
| Webhook URL generation | ✅ Working | Uses separate /webhook-handler endpoint |
| Token validation | ✅ Working | Bypasses JWT auth |
| Event storage | ✅ Working | Stores in KV store |
| Alpaca integration | ✅ Working | Executes trades automatically |
| Test UI (modal) | ✅ Working | Fixed blank screen issue |
| External webhook calls | ✅ Should work | Not tested yet with real TradingView |

---

## 🚨 Important Notes

1. **Alpaca Credentials Required**: User must connect Alpaca on Brokers page first
2. **Paper Trading**: Currently uses `paper-api.alpaca.markets` (safe for testing)
3. **Token Security**: Keep webhook URLs private - anyone with the URL can trigger trades!
4. **Payload Flexibility**: Supports multiple formats (TradingView, custom, etc.)
5. **Error Handling**: Failed trades are logged but don't crash the webhook

---

## 🐛 Debugging

Check browser console for:
- ✅ "Test webhook via proxy" - frontend calling backend
- ✅ "Webhook handler called" - webhook endpoint receiving request
- ✅ "Webhook found for user" - token validation success
- ✅ "Event stored" - database write success
- ✅ "Executing trade on Alpaca" - trade execution starting
- ✅ "Alpaca order executed successfully" - trade completed

Check Supabase logs for:
- Server-side errors
- Database connection issues
- Alpaca API errors

import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as kv from './kv_store.tsx';
import { MCP_TOOLS, handleMCPTool } from './mcp_server.tsx';

const app = new Hono();

app.use('*', cors());
app.use('*', logger(console.log));

// ===== GLOBAL REQUEST LOGGER =====
// This logs EVERY request that hits the server
app.use('*', async (c, next) => {
  const method = c.req.method;
  const url = c.req.url;
  const path = new URL(url).pathname;
  
  console.log(`📍 INCOMING REQUEST: ${method} ${path}`);
  
  // Special logging for POST requests
  if (method === 'POST') {
    console.log(`   🚨 POST REQUEST DETECTED!`);
    console.log(`   Full URL: ${url}`);
  }
  
  await next();
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// ============================================
// PUBLIC WEBHOOK RECEIVER - MUST BE FIRST!
// This endpoint receives webhooks from external services (TradingView, etc.)
// It does NOT require JWT authentication - validates using token parameter
// 
// ⚠️ CRITICAL: If webhooks stop working with 401 errors, check Supabase settings:
//    Edge Functions → make-server-f118884a → Details → "Verify JWT with legacy secret"
//    This MUST be DISABLED (toggled OFF) for public webhook endpoints to work!
//    
//    Without this, TradingView and other external services cannot POST to /webhook-receiver
//    because they don't have Supabase JWT tokens. The endpoint uses token-based auth instead.
// ============================================

app.post('/make-server-f118884a/webhook-receiver', async (c) => {
  const timestamp = new Date().toISOString();
  console.log('==========================================');
  console.log('🚨 WEBHOOK POST REQUEST RECEIVED');
  console.log('Timestamp:', timestamp);
  console.log('==========================================');
  
  try {
    // Get token from query parameter
    const url = new URL(c.req.url);
    const token = url.searchParams.get('token');
    
    console.log('🔍 STEP 1: Extract token from URL');
    console.log('   Full URL:', c.req.url);
    console.log('   Token:', token ? token.substring(0, 10) + '...' : 'MISSING');
    
    if (!token) {
      console.error('❌ FAILED: No token provided');
      return c.json({ 
        error: 'Missing token parameter',
        hint: 'URL should include ?token=YOUR_TOKEN'
      }, 400);
    }
    
    // Get payload
    let payload;
    try {
      payload = await c.req.json();
      console.log('✅ STEP 2: Received payload:', JSON.stringify(payload, null, 2));
    } catch (e) {
      console.error('❌ FAILED: Invalid JSON payload:', e);
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }
    
    // Look up webhook by token
    console.log('🔍 STEP 3: Looking up webhook token in database...');
    console.log('   Token key:', `webhook-token:${token.substring(0, 10)}...`);
    const tokenLookup = await kv.get(`webhook-token:${token}`);
    
    console.log('   Token lookup result:', tokenLookup ? 'FOUND' : 'NOT FOUND');
    if (tokenLookup) {
      console.log('   Token data:', JSON.stringify(tokenLookup, null, 2));
    }
    
    if (!tokenLookup) {
      console.error('❌ FAILED: Invalid token - not found in database');
      console.error('   Searched for key: webhook-token:' + token);
      return c.json({ 
        error: 'Invalid webhook token',
        token: token.substring(0, 10) + '...'
      }, 404);
    }
    
    const { userId, webhookId } = tokenLookup as { userId: string; webhookId: string };
    console.log('✅ STEP 4: Token validated! userId:', userId, 'webhookId:', webhookId);
    
    // Get webhook configuration
    console.log('🔍 STEP 5: Getting webhook configuration...');
    console.log('   Webhook key:', `user:${userId}:webhook:${webhookId}`);
    const webhookConfig = await kv.get(`user:${userId}:webhook:${webhookId}`);
    
    console.log('   Webhook config result:', webhookConfig ? 'FOUND' : 'NOT FOUND');
    if (webhookConfig) {
      console.log('   Webhook config data:', JSON.stringify(webhookConfig, null, 2));
    }
    
    if (!webhookConfig || webhookConfig.status !== 'active') {
      console.error('❌ FAILED: Webhook not active');
      return c.json({ error: 'Webhook is not active' }, 403);
    }
    
    console.log('✅ STEP 6: Webhook is active:', webhookConfig.name);
    
    // Normalize payload (support multiple formats)
    const normalized = {
      action: payload.action || payload.side || 'unknown',
      symbol: (payload.symbol || payload.ticker || 'unknown').toString().toUpperCase(),
      quantity: payload.quantity || payload.qty || 0,
      price: payload.price,
      orderType: payload.order_type || payload.type || 'market',
      strategy: payload.strategy || webhookConfig.strategy,
      timestamp: payload.timestamp || new Date().toISOString(),
      rawPayload: payload,
    };
    
    console.log('✅ STEP 7: Normalized payload:', normalized);
    
    // Store webhook event
    console.log('🔍 STEP 8: Storing event in database...');
    const eventId = crypto.randomUUID();
    const eventKey = `user:${userId}:webhook-event:${eventId}`;
    
    await kv.set(eventKey, {
      id: eventId,
      webhookId,
      webhookName: webhookConfig.name,
      payload: normalized,
      receivedAt: new Date().toISOString(),
      status: 'pending',
    });
    
    console.log('✅ STEP 9: Event stored with ID:', eventId);
    
    // Update webhook trigger count
    const updatedConfig = {
      ...webhookConfig,
      triggers: (webhookConfig.triggers || 0) + 1,
      lastTriggered: new Date().toISOString(),
    };
    
    await kv.set(`user:${userId}:webhook:${webhookId}`, updatedConfig);
    
    // Get Alpaca credentials and execute trade
    console.log('🔍 STEP 10: Checking for Alpaca broker connection...');
    
    // Get all brokers for this user
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    console.log(`   Found ${allBrokers?.length || 0} total brokers`);
    
    // Filter for Alpaca brokers that are connected
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      const isAlpaca = b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'));
      const isConnected = b.connected && b.apiKey && b.apiSecret;
      console.log(`   Broker ${b.id}:`);
      console.log(`      - isAlpaca: ${isAlpaca}`);
      console.log(`      - connected: ${b.connected}`);
      console.log(`      - hasApiKey: ${!!b.apiKey}`);
      console.log(`      - hasApiSecret: ${!!b.apiSecret}`);
      console.log(`      - isConnected: ${isConnected}`);
      return isAlpaca && isConnected;
    }) || [];
    
    console.log(`   Found ${alpacaBrokers.length} connected Alpaca brokers`);
    
    // Use the broker specified in webhook config, or the first connected Alpaca broker
    let alpacaBroker = null;
    if (webhookConfig.brokerId) {
      alpacaBroker = alpacaBrokers.find((b: any) => b.id === webhookConfig.brokerId);
      console.log(`   Webhook specifies broker ${webhookConfig.brokerId}: ${alpacaBroker ? 'FOUND' : 'NOT FOUND'}`);
    }
    
    if (!alpacaBroker && alpacaBrokers.length > 0) {
      alpacaBroker = alpacaBrokers[0];
      console.log(`   Using first available Alpaca broker: ${alpacaBroker.id}`);
    }
    
    if (!alpacaBroker) {
      console.error('❌ NO ALPACA BROKER AVAILABLE');
      console.error(`   Total brokers found: ${allBrokers?.length || 0}`);
      console.error(`   Alpaca brokers (connected): ${alpacaBrokers.length}`);
      console.error(`   Webhook specifies brokerId: ${webhookConfig.brokerId || 'none'}`);
    }
    
    let executionResult = null;
    let tradeId: string | null = null;
    
    if (alpacaBroker && alpacaBroker.apiKey && alpacaBroker.apiSecret) {
      console.log('✅ Alpaca connected, executing trade without risk checks...');
      console.log(`   Using broker: ${alpacaBroker.name} (${alpacaBroker.accountId})`);
      
      // ============================================
      // RISK MANAGEMENT CHECKS DISABLED
      // All webhook orders will be executed without blocking
      // ============================================
      
      console.log('✅ Risk management disabled - all webhook orders will execute');
      
      // ============================================
      // END RISK MANAGEMENT CHECKS
      // ============================================
      
      console.log('✅ Executing trade...');
      
      try {
        // Ensure quantity is a valid integer (Alpaca requires integers for stock orders)
        const validQuantity = Math.max(1, Math.floor(parseFloat(normalized.quantity) || 1));
        
        // Normalize side (Alpaca expects 'buy' or 'sell')
        let side = normalized.action.toLowerCase().trim();
        if (!['buy', 'sell'].includes(side)) {
          console.error(`⚠️ Invalid side "${side}", defaulting to "buy"`);
          side = 'buy';
        }
        
        // Normalize order type (Alpaca expects 'market', 'limit', 'stop', 'stop_limit')
        let orderType = normalized.orderType.toLowerCase().trim();
        if (!['market', 'limit', 'stop', 'stop_limit'].includes(orderType)) {
          console.error(`⚠️ Invalid order type "${orderType}", defaulting to "market"`);
          orderType = 'market';
        }
        
        const alpacaOrder = {
          symbol: normalized.symbol.toString().toUpperCase().trim(),
          qty: validQuantity,
          side: side,
          type: orderType,
          time_in_force: 'day',
        };
        
        if (normalized.orderType === 'limit' && normalized.price) {
          (alpacaOrder as any).limit_price = parseFloat(normalized.price).toFixed(2);
        }
        
        console.log('📤 Submitting to Alpaca:', JSON.stringify(alpacaOrder, null, 2));
        
        let alpacaResponse: any;
        let alpacaResult: any;
        let attemptNum = 1;
        let lastErr = '';
        let lastErrCode = '';
        
        // Helper to remove undefined fields
        const cleanOrder = (order: any) => {
          const cleaned: any = {};
          for (const key in order) {
            if (order[key] !== undefined) {
              cleaned[key] = order[key];
            }
          }
          return cleaned;
        };
        
        const retryConf = [
          cleanOrder(alpacaOrder),
          cleanOrder({ ...alpacaOrder, type: 'market', limit_price: undefined }),
          cleanOrder({ ...alpacaOrder, type: 'market', time_in_force: 'ioc', limit_price: undefined }),
          cleanOrder({ ...alpacaOrder, type: 'market', time_in_force: 'day', extended_hours: true, limit_price: undefined }),
        ];
        
        for (const retryPay of retryConf) {
          console.log(`\n🔄 Attempt ${attemptNum}:`, JSON.stringify(retryPay, null, 2));
          console.log(`   Using broker: ${alpacaBroker.name} (${alpacaBroker.accountId})`);
          console.log(`   API Key: ${alpacaBroker.apiKey.substring(0, 8)}...`);
          
          const requestBody = JSON.stringify(retryPay);
          console.log(`   Request body: ${requestBody}`);
          
          alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
            method: 'POST',
            headers: {
              'APCA-API-KEY-ID': alpacaBroker.apiKey,
              'APCA-API-SECRET-KEY': alpacaBroker.apiSecret,
              'Content-Type': 'application/json',
            },
            body: requestBody,
          });
          
          const responseText = await alpacaResponse.text();
          console.log(`   Response status: ${alpacaResponse.status}`);
          console.log(`   Response body: ${responseText}`);
          
          try {
            alpacaResult = JSON.parse(responseText);
          } catch (e) {
            console.error(`   ❌ Failed to parse JSON response: ${e}`);
            alpacaResult = { error: 'Invalid JSON response', rawResponse: responseText };
          }
          
          if (alpacaResponse.ok) {
            console.log(`✅ Order succeeded on attempt ${attemptNum}!`);
            break;
          } else {
            const errMsg = alpacaResult.message || alpacaResult.error || JSON.stringify(alpacaResult) || 'Order rejected';
            const errCode = alpacaResult.code || 'unknown';
            console.log(`   Full error response:`, JSON.stringify(alpacaResult, null, 2));
            lastErr = errMsg;
            lastErrCode = errCode;
            
            console.log(`❌ Attempt ${attemptNum} failed: ${errMsg} (${errCode})`);
            
            attemptNum++;
            
            if (attemptNum > retryConf.length) break;
            
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        if (alpacaResponse.ok) {
          console.log('✅ Alpaca order successful:', alpacaResult.id);
          
          // Create trade ID
          tradeId = crypto.randomUUID();
          
          // Store trade record (similar to tradingview-webhook endpoint)
          const tradeRecord = {
            id: tradeId,
            strategyId: webhookConfig.strategyId || webhookId, // Use webhookId as fallback if no strategyId
            strategyName: webhookConfig.strategy || webhookConfig.name,
            symbol: normalized.symbol,
            side: alpacaOrder.side,
            quantity: validQuantity,
            type: alpacaOrder.type,
            status: alpacaResult.status,
            orderId: alpacaResult.id,
            entryPrice: alpacaResult.filled_avg_price || normalized.price || null,
            exitPrice: null,
            pnl: null,
            source: 'webhook',
            submittedAt: timestamp,
            filledAt: alpacaResult.filled_at || null,
            broker: 'alpaca',
            brokerId: alpacaBroker.id, // Store which specific broker account was used
            brokerAccountId: alpacaBroker.accountId, // Store account number for reference
            brokerOrderId: alpacaResult.id,
            brokerResponse: alpacaResult,
          };
          
          await kv.set(`user:${userId}:trade:${tradeId}`, tradeRecord);
          console.log(`✅ Trade record created: ${tradeId}`);
          console.log(`   Linked to strategy: ${tradeRecord.strategyName} (ID: ${tradeRecord.strategyId})`);
          console.log(`   ${webhookConfig.strategyId ? '✅ Using webhook strategyId' : '⚠️ Using webhookId as fallback'}`);
          
          // Create notification for successful trade
          await createNotification(userId, {
            type: 'trade_filled',
            title: 'Trade Executed',
            message: `${alpacaOrder.side.toUpperCase()} ${normalized.quantity} ${normalized.symbol} via ${webhookConfig.name}`,
            metadata: {
              tradeId,
              symbol: normalized.symbol,
              side: alpacaOrder.side,
              quantity: normalized.quantity,
              strategyName: tradeRecord.strategyName,
              orderId: alpacaResult.id,
            },
          });
          
          executionResult = {
            success: true,
            broker: 'alpaca',
            orderId: alpacaResult.id,
            tradeId: tradeId,
            status: alpacaResult.status,
            alpacaOrder: alpacaResult, // Store full Alpaca response
          };
          
          // Update event with success
          await kv.set(eventKey, {
            id: eventId,
            webhookId,
            webhookName: webhookConfig.name,
            payload: normalized,
            receivedAt: new Date().toISOString(),
            status: 'success',
            execution: executionResult,
            tradeId: tradeId,
            alpacaOrder: alpacaResult, // Store Alpaca order details at top level for easy access
            broker: alpacaBroker.name,
            brokerId: alpacaBroker.id,
            brokerAccountId: alpacaBroker.accountId,
          });
        } else {
          console.error('\n❌ FINAL FAILURE - All retry attempts exhausted');
          console.log('   Status:', alpacaResponse.status);
          console.log('   Last error:', lastErr);
          console.log('   Last error code:', lastErrCode);
          
          const errorMessage = lastErr;
          const errorCode = lastErrCode;
          
          // Create trade ID for failed trade
          tradeId = crypto.randomUUID();
          
          // Store failed trade record
          const failedTradeRecord = {
            id: tradeId,
            strategyId: webhookConfig.strategyId || webhookId,
            strategyName: webhookConfig.strategy || webhookConfig.name,
            symbol: normalized.symbol,
            side: alpacaOrder.side,
            quantity: validQuantity,
            type: alpacaOrder.type,
            status: 'rejected',
            error: errorMessage,
            errorCode: errorCode,
            source: 'webhook',
            submittedAt: timestamp,
            broker: 'alpaca',
            brokerId: alpacaBroker.id, // Store which specific broker account was used
            brokerAccountId: alpacaBroker.accountId, // Store account number for reference
            brokerResponse: alpacaResult,
          };
          
          await kv.set(`user:${userId}:trade:${tradeId}`, failedTradeRecord);
          console.log(`❌ Failed trade record created: ${tradeId}`);
          console.log(`   Linked to strategy: ${failedTradeRecord.strategyName} (ID: ${failedTradeRecord.strategyId})`);
          
          // Create notification for rejected trade
          await createNotification(userId, {
            type: 'trade_rejected',
            title: 'Trade Rejected',
            message: `${normalized.action.toUpperCase()} ${normalized.quantity} ${normalized.symbol} - ${alpacaResult.message || 'Order rejected'}`,
            metadata: {
              tradeId,
              symbol: normalized.symbol,
              side: normalized.action,
              quantity: normalized.quantity,
              error: alpacaResult.message,
              webhookName: webhookConfig.name,
            },
          });
          
          executionResult = {
            success: false,
            broker: 'alpaca',
            tradeId: tradeId,
            error: errorMessage,
            errorCode: errorCode,
            alpacaError: alpacaResult, // Store full error response
          };
          
          // Update event with failure
          await kv.set(eventKey, {
            id: eventId,
            webhookId,
            webhookName: webhookConfig.name,
            payload: normalized,
            receivedAt: new Date().toISOString(),
            status: 'error',
            execution: executionResult,
            tradeId: tradeId,
            error: `${errorMessage}${errorCode !== 'unknown' ? ` (${errorCode})` : ''}`,
            reason: `${errorMessage}${errorCode !== 'unknown' ? ` (${errorCode})` : ''}`,
            attempts: attemptNum,
            alpacaError: alpacaResult, // Include full Alpaca error response for debugging
            broker: alpacaBroker.name,
            brokerId: alpacaBroker.id,
            brokerAccountId: alpacaBroker.accountId,
          });
        }
      } catch (alpacaError) {
        console.error('❌ Alpaca API error:', alpacaError);
        
        // Create trade ID for error trade
        tradeId = crypto.randomUUID();
        
        const errorMsg = String(alpacaError);
        
        // Store error trade record
        const errorTradeRecord = {
          id: tradeId,
          strategyId: webhookConfig.strategyId || webhookId,
          strategyName: webhookConfig.strategy || webhookConfig.name,
          symbol: normalized.symbol,
          side: normalized.action.toLowerCase(),
          quantity: validQuantity,
          type: normalized.orderType.toLowerCase(),
          status: 'error',
          error: errorMsg,
          source: 'webhook',
          submittedAt: timestamp,
          broker: 'alpaca',
          brokerId: alpacaBroker.id, // Store which specific broker account was used
          brokerAccountId: alpacaBroker.accountId, // Store account number for reference
        };
        
        await kv.set(`user:${userId}:trade:${tradeId}`, errorTradeRecord);
        console.log(`❌ Error trade record created: ${tradeId}`);
        console.log(`   Linked to strategy: ${errorTradeRecord.strategyName} (ID: ${errorTradeRecord.strategyId})`);
        
        executionResult = {
          success: false,
          tradeId: tradeId,
          error: errorMsg,
        };
        
        // Update event with error
        await kv.set(eventKey, {
          id: eventId,
          webhookId,
          webhookName: webhookConfig.name,
          payload: normalized,
          receivedAt: new Date().toISOString(),
          status: 'error',
          execution: executionResult,
          tradeId: tradeId,
          error: errorMsg,
          reason: errorMsg,
        });
      }
    } else {
      console.log('⚠️ Alpaca not connected - event stored but not executed');
      executionResult = {
        success: false,
        error: 'No broker connected',
      };
      
      await kv.set(eventKey, {
        id: eventId,
        webhookId,
        webhookName: webhookConfig.name,
        payload: normalized,
        receivedAt: new Date().toISOString(),
        status: 'error',
        execution: executionResult,
        error: 'No broker connected',
        reason: 'Alpaca broker is not connected',
      });
    }
    
    console.log('========== WEBHOOK COMPLETE ==========');
    
    return c.json({
      success: true,
      eventId,
      tradeId,
      message: 'Webhook processed',
      webhook: webhookConfig.name,
      execution: executionResult,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    return c.json({
      error: 'Internal server error',
      message: String(error),
    }, 500);
  }
});

// PUBLIC TEST ENDPOINTS - No auth required
// These must come BEFORE verifyUser is called

// Health check
app.get('/make-server-f118884a/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Debug endpoint - check user's brokers (requires auth)
app.get('/make-server-f118884a/debug/brokers', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    
    const brokerDebugInfo = allBrokers?.map((b: any) => ({
      id: b.id,
      name: b.name,
      brokerType: b.brokerType,
      connected: b.connected,
      accountId: b.accountId,
      hasApiKey: !!b.apiKey,
      hasApiSecret: !!b.apiSecret,
      apiKeyPreview: b.apiKey ? b.apiKey.substring(0, 8) + '...' : 'none',
    })) || [];
    
    return c.json({
      userId,
      totalBrokers: allBrokers?.length || 0,
      brokers: brokerDebugInfo,
    });
  } catch (error) {
    return c.json({ error: String(error) }, 500);
  }
});

// Debug endpoint - test Alpaca connection with dummy order (requires auth)
app.post('/make-server-f118884a/debug/test-alpaca', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) && b.connected && b.apiKey && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'No connected Alpaca brokers found' }, 404);
    }
    
    const broker = alpacaBrokers[0];
    
    // Test with a simple market order for 1 share of AAPL
    const testOrder = {
      symbol: 'AAPL',
      qty: 1,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    };
    
    console.log('🧪 Testing Alpaca connection...');
    console.log(`   Broker: ${broker.name} (${broker.accountId})`);
    console.log(`   API Key: ${broker.apiKey.substring(0, 8)}...`);
    console.log(`   Test Order:`, JSON.stringify(testOrder, null, 2));
    
    const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testOrder),
    });
    
    const responseText = await alpacaResponse.text();
    let alpacaResult;
    try {
      alpacaResult = JSON.parse(responseText);
    } catch (e) {
      alpacaResult = { error: 'Invalid JSON', rawResponse: responseText };
    }
    
    console.log(`   Response status: ${alpacaResponse.status}`);
    console.log(`   Response:`, JSON.stringify(alpacaResult, null, 2));
    
    return c.json({
      broker: {
        id: broker.id,
        name: broker.name,
        accountId: broker.accountId,
      },
      testOrder,
      response: {
        status: alpacaResponse.status,
        ok: alpacaResponse.ok,
        data: alpacaResult,
      },
    });
  } catch (error) {
    console.error('Debug test error:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Test endpoint - check if webhook token exists (PUBLIC)
app.get('/make-server-f118884a/test-webhook-token/:token', async (c) => {
  const token = c.req.param('token');
  console.log(`Testing webhook token: ${token}`);
  
  const webhookLookup = await kv.get(`webhook-token:${token}`);
  
  if (!webhookLookup) {
    return c.json({ 
      exists: false, 
      token,
      message: 'Webhook token not found in database'
    });
  }
  
  const { userId, webhookId } = webhookLookup;
  const webhook = await kv.get(`user:${userId}:webhook:${webhookId}`);
  
  return c.json({ 
    exists: true, 
    token,
    userId,
    webhookId,
    webhookName: webhook?.name,
    message: 'Webhook token is valid and ready to receive requests'
  });
});

// Test endpoint - get all events in database (PUBLIC, for debugging)
app.get('/make-server-f118884a/test-all-events', async (c) => {
  try {
    // Get all webhook events regardless of user
    const allEvents = await kv.getByPrefix('user:');
    const webhookEvents = allEvents.filter((item: any) => 
      item.id && item.webhookId && item.receivedAt
    );
    
    console.log(`Found ${webhookEvents?.length || 0} webhook events in database`);
    
    // Group by user
    const eventsByUser: Record<string, number> = {};
    webhookEvents.forEach((event: any) => {
      // Extract userId from the key pattern: user:${userId}:webhook-event:${eventId}
      // The event object has the data, we need to track which user it belongs to
      const userId = event.strategyId ? 'has-strategy' : 'no-strategy';
      eventsByUser[userId] = (eventsByUser[userId] || 0) + 1;
    });
    
    // Also get all strategies to see user associations
    const allStrategies = allEvents.filter((item: any) => 
      item.name && item.webhookToken && item.userId
    );
    
    console.log(`Found ${allStrategies?.length || 0} strategies`);
    console.log('Events by user:', eventsByUser);
    
    return c.json({
      totalEvents: webhookEvents.length,
      events: webhookEvents.slice(0, 10), // Return first 10 for inspection
      eventsByUser,
      strategiesCount: allStrategies.length,
      strategies: allStrategies.map((s: any) => ({
        id: s.id,
        name: s.name,
        userId: s.userId,
      })),
    });
  } catch (error) {
    console.log('Error fetching test data:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Diagnostic endpoint - check what user ID is authenticated
app.get('/make-server-f118884a/test-my-userid', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    
    if (error) {
      return c.json({ 
        authenticated: false, 
        error,
        userId: null 
      });
    }
    
    // Get events for this user
    const events = await kv.getByPrefix(`user:${userId}:webhook-event:`);
    
    // Get strategies for this user
    const allItems = await kv.getByPrefix('user:');
    const strategies = allItems.filter((item: any) => 
      item.userId === userId && item.name && item.webhookToken
    );
    
    return c.json({
      authenticated: true,
      userId,
      eventsCount: events?.length || 0,
      strategiesCount: strategies?.length || 0,
      strategies: strategies.map((s: any) => ({
        id: s.id,
        name: s.name,
      })),
    });
  } catch (error) {
    console.log('Error in diagnostic endpoint:', error);
    return c.json({ error: String(error) }, 500);
  }
});

// Helper function to verify user auth
async function verifyUser(authHeader: string | null) {
  try {
    if (!authHeader) {
      console.log('❌ No authorization header provided');
      return { error: 'No authorization header', userId: null };
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      console.log('❌ No token in authorization header');
      return { error: 'No token provided', userId: null };
    }

    // Verify the token with Supabase Auth
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log('❌ Invalid token or user not found:', error?.message);
      return { error: 'Invalid authentication token', userId: null };
    }

    console.log('✅ User authenticated:', user.id);
    return { error: null, userId: user.id };
  } catch (error) {
    console.log('❌ Error verifying user:', error);
    return { error: 'Authentication failed', userId: null };
  }
}

// Helper function to create notifications
async function createNotification(userId: string, notification: {
  type: 'trade_filled' | 'trade_rejected' | 'risk_limit_hit' | 'strategy_paused' | 'webhook_triggered' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
  metadata?: any;
}) {
  try {
    const notificationId = crypto.randomUUID();
    await kv.set(`user:${userId}:notification:${notificationId}`, {
      id: notificationId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata || {},
      read: false,
      createdAt: new Date().toISOString(),
    });
    console.log(`📬 Notification created: ${notification.title}`);
  } catch (error) {
    console.error('Error creating notification:', error);
    // Don't fail the main operation if notification fails
  }
}

// ============================================
// AUTH ROUTES
// ============================================

app.post('/make-server-f118884a/auth/signup', async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name },
      // Automatically confirm the user's email since an email server hasn't been configured.
      email_confirm: true,
    });
    
    if (error) {
      console.log(`Error during signup: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }
    
    // Initialize user data in KV store
    const userId = data.user.id;
    await kv.set(`user:${userId}:profile`, {
      name,
      email,
      createdAt: new Date().toISOString(),
    });
    
    return c.json({ success: true, user: data.user });
  } catch (error) {
    console.log(`Signup error: ${error}`);
    return c.json({ error: 'Signup failed' }, 500);
  }
});

// Login endpoint
app.post('/make-server-f118884a/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    
    // Create a Supabase client that can perform auth operations
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );
    
    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.log(`Login error: ${error.message}`);
      return c.json({ error: error.message }, 401);
    }
    
    if (!data.session) {
      return c.json({ error: 'No session created' }, 401);
    }
    
    return c.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: data.user,
    });
  } catch (error) {
    console.log(`Login error: ${error}`);
    return c.json({ error: 'Login failed' }, 500);
  }
});

// ============================================
// DASHBOARD ROUTES
// ============================================

app.get('/make-server-f118884a/dashboard/metrics', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const metrics = await kv.get(`user:${userId}:metrics`);
    
    // Return empty metrics if none exist
    if (!metrics) {
      return c.json({
        totalEquity: 0,
        buyingPower: 0,
        dayChange: 0,
        dayChangePercent: 0,
        activeAlerts: 0,
      });
    }
    
    return c.json(metrics);
  } catch (error) {
    console.log(`Error fetching dashboard metrics: ${error}`);
    return c.json({ error: 'Failed to fetch metrics' }, 500);
  }
});

app.get('/make-server-f118884a/dashboard/equity-curve', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const equityCurve = await kv.get(`user:${userId}:equity-curve`);
    
    // Return empty array if none exists - no sample data for new users
    if (!equityCurve) {
      return c.json([]);
    }
    
    return c.json(equityCurve);
  } catch (error) {
    console.log(`Error fetching equity curve: ${error}`);
    return c.json({ error: 'Failed to fetch equity curve' }, 500);
  }
});

app.get('/make-server-f118884a/dashboard/positions', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const positions = await kv.getByPrefix(`user:${userId}:position:`);
    return c.json(positions || []);
  } catch (error) {
    console.log(`Error fetching positions: ${error}`);
    return c.json({ error: 'Failed to fetch positions' }, 500);
  }
});

app.get('/make-server-f118884a/dashboard/recent-orders', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const orders = await kv.getByPrefix(`user:${userId}:order:`);
    return c.json(orders || []);
  } catch (error) {
    console.log(`Error fetching recent orders: ${error}`);
    return c.json({ error: 'Failed to fetch recent orders' }, 500);
  }
});

// ============================================
// TRADES ROUTES
// ============================================

app.get('/make-server-f118884a/trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const trades = await kv.getByPrefix(`user:${userId}:trade:`);
    return c.json(trades || []);
  } catch (error) {
    console.log(`Error fetching trades: ${error}`);
    return c.json({ error: 'Failed to fetch trades' }, 500);
  }
});

app.post('/make-server-f118884a/trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const trade = await c.req.json();
    const tradeId = crypto.randomUUID();
    
    await kv.set(`user:${userId}:trade:${tradeId}`, {
      ...trade,
      id: tradeId,
      userId,
      createdAt: new Date().toISOString(),
    });
    
    return c.json({ success: true, tradeId });
  } catch (error) {
    console.log(`Error creating trade: ${error}`);
    return c.json({ error: 'Failed to create trade' }, 500);
  }
});

// ============================================
// STRATEGY ROUTES
// ============================================

app.get('/make-server-f118884a/strategies', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    return c.json(strategies || []);
  } catch (error) {
    console.log(`Error fetching strategies: ${error}`);
    return c.json({ error: 'Failed to fetch strategies' }, 500);
  }
});

app.post('/make-server-f118884a/strategies', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategy = await c.req.json();
    const strategyId = crypto.randomUUID();
    
    // Only create webhook URL for TradingView strategies
    let webhookToken = null;
    let webhookUrl = null;
    
    if (strategy.strategyType === 'tradingview') {
      webhookToken = crypto.randomUUID();
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      webhookUrl = `${supabaseUrl}/functions/v1/make-server-f118884a/tradingview-webhook/${strategyId}?token=${webhookToken}`;
      console.log(`✅ Created TradingView webhook for strategy: ${strategy.name}`);
    } else {
      console.log(`✅ Created manual/algorithmic strategy (no webhook): ${strategy.name}`);
    }
    
    await kv.set(`user:${userId}:strategy:${strategyId}`, {
      ...strategy,
      id: strategyId,
      userId,
      webhookToken,
      webhookUrl,
      createdAt: new Date().toISOString(),
    });
    
    return c.json({ success: true, strategyId, webhookUrl });
  } catch (error) {
    console.log(`Error creating strategy: ${error}`);
    return c.json({ error: 'Failed to create strategy' }, 500);
  }
});

app.put('/make-server-f118884a/strategies/:id', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    const updates = await c.req.json();
    
    const existing = await kv.get(`user:${userId}:strategy:${strategyId}`);
    if (!existing) {
      return c.json({ error: 'Strategy not found' }, 404);
    }
    
    // Handle strategy type change - create or remove webhook URL
    let updatedData = { ...existing, ...updates };
    
    if (updates.strategyType && updates.strategyType !== existing.strategyType) {
      if (updates.strategyType === 'tradingview' && !existing.webhookToken) {
        // Switching to TradingView - create webhook
        const webhookToken = crypto.randomUUID();
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const webhookUrl = `${supabaseUrl}/functions/v1/make-server-f118884a/tradingview-webhook/${strategyId}?token=${webhookToken}`;
        updatedData = { ...updatedData, webhookToken, webhookUrl };
        console.log(`✅ Added TradingView webhook to existing strategy`);
      } else if (updates.strategyType === 'manual') {
        // Switching to Manual - keep webhook data for history but user won't see it
        console.log(`✅ Switched strategy to manual mode`);
      }
    }
    
    await kv.set(`user:${userId}:strategy:${strategyId}`, {
      ...updatedData,
      updatedAt: new Date().toISOString(),
    });
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error updating strategy: ${error}`);
    return c.json({ error: 'Failed to update strategy' }, 500);
  }
});

app.delete('/make-server-f118884a/strategies/:id', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    await kv.del(`user:${userId}:strategy:${strategyId}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error deleting strategy: ${error}`);
    return c.json({ error: 'Failed to delete strategy' }, 500);
  }
});

// Clear risk settings for all strategies
app.post('/make-server-f118884a/strategies/clear-risk-settings', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allStrategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    let updatedCount = 0;
    
    for (const strategy of allStrategies) {
      // Clear all risk-related settings
      await kv.set(`user:${userId}:strategy:${strategy.id}`, {
        ...strategy,
        maxPositions: null,
        maxDailyLoss: null,
        tradingHoursStart: null,
        tradingHoursEnd: null,
        symbols: '',
        updatedAt: new Date().toISOString(),
      });
      updatedCount++;
    }
    
    console.log(`✅ Cleared risk settings for ${updatedCount} strategies`);
    return c.json({ 
      success: true, 
      message: `Risk settings cleared for ${updatedCount} strategies`,
      updatedCount 
    });
  } catch (error) {
    console.log(`Error clearing risk settings: ${error}`);
    return c.json({ error: 'Failed to clear risk settings' }, 500);
  }
});

// Debug endpoint - get all trades with their strategy IDs
app.get('/make-server-f118884a/debug/trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const allStrategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    
    // Map strategy IDs to names and also map by name to ID
    const strategyMap: Record<string, string> = {};
    const strategyNameToId: Record<string, string> = {};
    allStrategies.forEach((s: any) => {
      strategyMap[s.id] = s.name;
      strategyNameToId[s.name] = s.id;
    });
    
    // Group trades by strategyId
    const tradesByStrategy: Record<string, any[]> = {};
    const orphanedTrades: any[] = [];
    
    allTrades.forEach((trade: any) => {
      const stratId = trade.strategyId || 'no-strategy-id';
      if (!tradesByStrategy[stratId]) {
        tradesByStrategy[stratId] = [];
      }
      
      // Check if this strategy ID exists
      const strategyExists = strategyMap[stratId];
      
      tradesByStrategy[stratId].push({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.side,
        status: trade.status,
        submittedAt: trade.submittedAt,
        strategyName: trade.strategyName,
        strategyExists: !!strategyExists,
      });
      
      // If trade has a strategyName but the strategyId doesn't match current strategies, it's orphaned
      if (trade.strategyName && !strategyExists) {
        orphanedTrades.push({
          tradeId: trade.id,
          oldStrategyId: stratId,
          strategyName: trade.strategyName,
          correctStrategyId: strategyNameToId[trade.strategyName] || 'not-found',
        });
      }
    });
    
    return c.json({
      totalTrades: allTrades.length,
      totalStrategies: allStrategies.length,
      strategyMap,
      strategyNameToId,
      tradesByStrategy,
      orphanedTrades,
    });
  } catch (error) {
    console.log(`Error fetching debug info: ${error}`);
    return c.json({ error: 'Failed to fetch debug info' }, 500);
  }
});

// Fix orphaned trades - reassign trades to correct strategy based on strategy name
app.post('/make-server-f118884a/debug/fix-trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const allStrategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    
    // Map strategy names to IDs
    const strategyNameToId: Record<string, string> = {};
    const strategyIdToName: Record<string, string> = {};
    allStrategies.forEach((s: any) => {
      strategyNameToId[s.name] = s.id;
      strategyIdToName[s.id] = s.name;
    });
    
    let fixedCount = 0;
    const updates: string[] = [];
    
    // Fix trades that have a strategyName but wrong strategyId
    for (const trade of allTrades) {
      if (trade.strategyName) {
        const correctStrategyId = strategyNameToId[trade.strategyName];
        
        // If we found a matching strategy and the IDs don't match, fix it
        if (correctStrategyId && trade.strategyId !== correctStrategyId) {
          const updatedTrade = { ...trade, strategyId: correctStrategyId };
          await kv.set(`user:${userId}:trade:${trade.id}`, updatedTrade);
          fixedCount++;
          updates.push(`Fixed trade ${trade.id}: ${trade.strategyId} → ${correctStrategyId} (${trade.strategyName})`);
          console.log(`✅ Fixed trade ${trade.id}: strategyId ${trade.strategyId} → ${correctStrategyId}`);
        }
      }
    }
    
    return c.json({
      success: true,
      fixedCount,
      updates,
      message: `Fixed ${fixedCount} orphaned trades`,
    });
  } catch (error) {
    console.log(`Error fixing trades: ${error}`);
    return c.json({ error: 'Failed to fix trades' }, 500);
  }
});

// Debug endpoint - show strategy risk settings and blocked trades
app.get('/make-server-f118884a/debug/strategy-risk', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const allStrategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    const allWebhookEvents = await kv.getByPrefix(`user:${userId}:webhook_event:`);
    
    // Get blocked events
    const blockedEvents = allWebhookEvents.filter((e: any) => e.status === 'blocked');
    
    // Group blocked events by strategy
    const blockedByStrategy: Record<string, any[]> = {};
    for (const event of blockedEvents) {
      const strategyName = event.strategyName || 'Unknown';
      if (!blockedByStrategy[strategyName]) {
        blockedByStrategy[strategyName] = [];
      }
      blockedByStrategy[strategyName].push({
        symbol: event.payload?.symbol,
        action: event.payload?.action,
        timestamp: event.receivedAt,
        reason: event.reason || event.error,
      });
    }
    
    // Build strategy info
    const strategyInfo = allStrategies.map((s: any) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      riskSettings: {
        maxPositions: s.maxPositions,
        maxDailyLoss: s.maxDailyLoss,
        tradingHours: `${s.tradingHoursStart} - ${s.tradingHoursEnd}`,
        allowedSymbols: s.symbols || 'All',
      },
      blockedTrades: blockedByStrategy[s.name] || [],
      blockedCount: (blockedByStrategy[s.name] || []).length,
    }));
    
    return c.json({
      strategies: strategyInfo,
      totalBlocked: blockedEvents.length,
      summary: {
        totalStrategies: allStrategies.length,
        activeStrategies: allStrategies.filter((s: any) => s.status === 'active').length,
        totalBlockedEvents: blockedEvents.length,
      },
    });
  } catch (error) {
    console.log(`Error fetching strategy risk debug info: ${error}`);
    return c.json({ error: 'Failed to fetch debug info' }, 500);
  }
});

// Backtest a strategy
app.post('/make-server-f118884a/strategies/:id/backtest', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    const { startDate, endDate, initialCapital } = await c.req.json();
    
    // Get the strategy
    const strategy = await kv.get(`user:${userId}:strategy:${strategyId}`);
    if (!strategy) {
      return c.json({ error: 'Strategy not found' }, 404);
    }
    
    // Get broker credentials for Alpaca (support multi-broker accounts)
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca broker not connected. Please connect your broker first.' }, 400);
    }
    
    const brokerData = alpacaBrokers[0];
    
    console.log(`🔄 Running backtest for strategy: ${strategy.name}`);
    console.log(`  Period: ${startDate} to ${endDate}`);
    console.log(`  Initial Capital: $${initialCapital}`);
    
    // Parse symbols
    const symbols = strategy.symbols.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    
    if (symbols.length === 0) {
      return c.json({ error: 'No symbols configured in strategy' }, 400);
    }
    
    // Fetch historical data for all symbols
    const historicalData: any = {};
    
    for (const symbol of symbols) {
      try {
        const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?start=${startDate}&end=${endDate}&timeframe=1Day&limit=10000`;
        
        const response = await fetch(url, {
          headers: {
            'APCA-API-KEY-ID': brokerData.apiKey,
            'APCA-API-SECRET-KEY': brokerData.apiSecret,
          },
        });
        
        if (!response.ok) {
          console.log(`⚠️ Failed to fetch data for ${symbol}: ${response.status}`);
          continue;
        }
        
        const data = await response.json();
        historicalData[symbol] = data.bars || [];
      } catch (err) {
        console.log(`⚠️ Error fetching ${symbol}: ${err}`);
      }
    }
    
    // Run backtest simulation
    const backtestResults = await runBacktestSimulation(strategy, historicalData, initialCapital);
    
    // Store backtest results
    const backtestId = crypto.randomUUID();
    await kv.set(`user:${userId}:backtest:${backtestId}`, {
      id: backtestId,
      strategyId,
      strategyName: strategy.name,
      startDate,
      endDate,
      initialCapital,
      results: backtestResults,
      createdAt: new Date().toISOString(),
    });
    
    console.log(`✅ Backtest completed: ${backtestResults.totalTrades} trades, ${backtestResults.totalReturn.toFixed(2)}% return`);
    
    return c.json({ 
      success: true, 
      backtestId,
      results: backtestResults 
    });
  } catch (error) {
    console.log(`Error running backtest: ${error}`);
    return c.json({ error: 'Failed to run backtest' }, 500);
  }
});

// Get backtest results for a strategy
app.get('/make-server-f118884a/strategies/:id/backtests', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    const allBacktests = await kv.getByPrefix(`user:${userId}:backtest:`);
    
    // Filter backtests for this strategy
    const strategyBacktests = allBacktests.filter((bt: any) => bt.strategyId === strategyId);
    
    return c.json(strategyBacktests || []);
  } catch (error) {
    console.log(`Error fetching backtests: ${error}`);
    return c.json({ error: 'Failed to fetch backtests' }, 500);
  }
});

// Helper function to run backtest simulation
async function runBacktestSimulation(strategy: any, historicalData: any, initialCapital: number) {
  const trades: any[] = [];
  const equityCurve: any[] = [];
  let cash = initialCapital;
  let positions: any[] = [];
  
  // Get all unique dates across all symbols
  const allDates = new Set<string>();
  for (const symbol in historicalData) {
    historicalData[symbol].forEach((bar: any) => {
      allDates.add(bar.t.split('T')[0]);
    });
  }
  
  const sortedDates = Array.from(allDates).sort();
  
  // Simulate trading day by day
  for (const date of sortedDates) {
    const dateData: any = {};
    
    // Get price data for this date for all symbols
    for (const symbol in historicalData) {
      const bar = historicalData[symbol].find((b: any) => b.t.startsWith(date));
      if (bar) {
        dateData[symbol] = bar;
      }
    }
    
    // Check exit conditions for existing positions
    const closedPositions: string[] = [];
    for (const position of positions) {
      const currentBar = dateData[position.symbol];
      if (!currentBar) continue;
      
      const currentPrice = currentBar.c;
      const entryPrice = position.entryPrice;
      const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      let shouldExit = false;
      let exitReason = '';
      
      // Check exit signal
      if (strategy.exitSignal.includes('Take Profit')) {
        const targetMatch = strategy.exitSignal.match(/(\d+)%/);
        const targetPercent = targetMatch ? parseFloat(targetMatch[1]) : 3;
        if (pnlPercent >= targetPercent) {
          shouldExit = true;
          exitReason = `Take Profit ${targetPercent}%`;
        }
      } else if (strategy.exitSignal.includes('Trailing Stop')) {
        // Simple trailing stop at -2%
        if (pnlPercent <= -2) {
          shouldExit = true;
          exitReason = 'Trailing Stop';
        }
      }
      
      // Also check stop loss at -5%
      if (pnlPercent <= -5) {
        shouldExit = true;
        exitReason = 'Stop Loss';
      }
      
      if (shouldExit) {
        const pnl = (currentPrice - entryPrice) * position.shares;
        cash += currentPrice * position.shares;
        
        trades.push({
          symbol: position.symbol,
          entryDate: position.entryDate,
          exitDate: date,
          entryPrice: entryPrice,
          exitPrice: currentPrice,
          shares: position.shares,
          pnl: pnl,
          pnlPercent: pnlPercent,
          exitReason: exitReason,
        });
        
        closedPositions.push(position.symbol);
      }
    }
    
    // Remove closed positions
    positions = positions.filter(p => !closedPositions.includes(p.symbol));
    
    // Check entry conditions if we have room for more positions
    if (positions.length < strategy.maxPositions) {
      for (const symbol in dateData) {
        // Skip if already have position
        if (positions.find(p => p.symbol === symbol)) continue;
        
        const bar = dateData[symbol];
        let shouldEnter = false;
        
        // Simple entry logic based on entry signal
        if (strategy.entrySignal.includes('RSI')) {
          // Simplified: enter on random 20% of days (simulating RSI oversold)
          shouldEnter = Math.random() < 0.2;
        } else if (strategy.entrySignal.includes('MACD') || strategy.entrySignal.includes('Moving Average')) {
          // Simplified: enter on random 15% of days
          shouldEnter = Math.random() < 0.15;
        } else if (strategy.entrySignal.includes('Bollinger')) {
          // Simplified: enter on random 10% of days
          shouldEnter = Math.random() < 0.1;
        } else if (strategy.entrySignal.includes('Volume')) {
          // Simplified: enter when volume is above average (rough approximation)
          shouldEnter = bar.v > 1000000;
        }
        
        if (shouldEnter && cash >= strategy.positionSize) {
          const shares = Math.floor(strategy.positionSize / bar.c);
          const cost = shares * bar.c;
          
          if (shares > 0 && cost <= cash) {
            cash -= cost;
            positions.push({
              symbol: symbol,
              entryDate: date,
              entryPrice: bar.c,
              shares: shares,
            });
          }
        }
        
        // Stop if we've reached max positions
        if (positions.length >= strategy.maxPositions) break;
      }
    }
    
    // Calculate current equity
    let positionValue = 0;
    for (const position of positions) {
      const currentBar = dateData[position.symbol];
      if (currentBar) {
        positionValue += currentBar.c * position.shares;
      } else {
        // Use entry price if no current data
        positionValue += position.entryPrice * position.shares;
      }
    }
    
    const totalEquity = cash + positionValue;
    equityCurve.push({
      date: date,
      equity: totalEquity,
      cash: cash,
      positions: positionValue,
    });
  }
  
  // Close any remaining positions at end
  for (const position of positions) {
    const lastDate = sortedDates[sortedDates.length - 1];
    const lastBar = historicalData[position.symbol]?.find((b: any) => b.t.startsWith(lastDate));
    
    if (lastBar) {
      const currentPrice = lastBar.c;
      const pnl = (currentPrice - position.entryPrice) * position.shares;
      cash += currentPrice * position.shares;
      
      trades.push({
        symbol: position.symbol,
        entryDate: position.entryDate,
        exitDate: lastDate,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        shares: position.shares,
        pnl: pnl,
        pnlPercent: ((currentPrice - position.entryPrice) / position.entryPrice) * 100,
        exitReason: 'End of Period',
      });
    }
  }
  
  // Calculate metrics
  const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialCapital;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;
  
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
  
  const avgWin = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / winningTrades.length 
    : 0;
  const avgLoss = losingTrades.length > 0 
    ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losingTrades.length 
    : 0;
  
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * winningTrades.length / (avgLoss * losingTrades.length)) : 0;
  
  // Calculate max drawdown
  let maxEquity = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.equity > maxEquity) {
      maxEquity = point.equity;
    }
    const drawdown = ((maxEquity - point.equity) / maxEquity) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  // Calculate Sharpe ratio (simplified)
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const dailyReturn = (equityCurve[i].equity - equityCurve[i-1].equity) / equityCurve[i-1].equity;
    returns.push(dailyReturn);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 0 
    ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length)
    : 0;
  const sharpeRatio = stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  
  return {
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: winRate,
    totalReturn: totalReturn,
    finalEquity: finalEquity,
    initialCapital: initialCapital,
    netProfit: finalEquity - initialCapital,
    avgWin: avgWin,
    avgLoss: avgLoss,
    profitFactor: profitFactor,
    maxDrawdown: maxDrawdown,
    sharpeRatio: sharpeRatio,
    equityCurve: equityCurve,
    trades: trades,
  };
}

// ============================================
// TRADINGVIEW STRATEGY WEBHOOK (PUBLIC ENDPOINT)
// ============================================

// TradingView webhook for specific strategy - PUBLIC endpoint with token validation
app.post('/make-server-f118884a/tradingview-webhook/:strategyId', async (c) => {
  const timestamp = new Date().toISOString();
  const strategyId = c.req.param('strategyId');
  const token = c.req.query('token');
  
  console.log('==========================================');
  console.log('📊 TRADINGVIEW STRATEGY WEBHOOK RECEIVED');
  console.log(`  Time: ${timestamp}`);
  console.log(`  Strategy ID: ${strategyId}`);
  console.log(`  Token: ${token ? '✅ Present' : '❌ Missing'}`);
  
  try {
    // Validate token
    if (!token) {
      console.log('❌ No token provided');
      return c.json({ error: 'Missing token' }, 401);
    }
    
    // Get all strategies and find the one with matching ID and token
    let strategy: any = null;
    let userId: string | null = null;
    
    const allUsers = await kv.getByPrefix('user:');
    for (const item of allUsers) {
      if (item.id === strategyId && item.webhookToken === token) {
        strategy = item;
        userId = item.userId;
        break;
      }
    }
    
    if (!strategy || !userId) {
      console.log('❌ Invalid strategy ID or token');
      return c.json({ error: 'Invalid strategy or token' }, 401);
    }
    
    console.log(`✅ Strategy validated: "${strategy.name}"`);
    console.log(`   Strategy ID: ${strategyId}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   This webhook is UNIQUE to this strategy - trades will be tracked separately`);
    
    // Parse TradingView webhook payload
    const payload = await c.req.json();
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));
    
    // Extract signal information
    const action = payload.action || payload.strategy?.order_action; // 'buy' or 'sell'
    const symbol = payload.ticker || payload.symbol;
    const price = payload.price || payload.close;
    const quantity = payload.quantity || payload.contracts || 1;
    
    if (!action || !symbol) {
      console.log('❌ Missing required fields (action or symbol)');
      return c.json({ error: 'Missing required fields: action and symbol' }, 400);
    }
    
    console.log(`📈 Signal: ${action.toUpperCase()} ${quantity} shares of ${symbol} at $${price || 'market'}`);
    
    // Store webhook event for logging (so it appears in Webhook Logs tab)
    const eventId = crypto.randomUUID();
    const eventKey = `user:${userId}:webhook-event:${eventId}`;
    
    await kv.set(eventKey, {
      id: eventId,
      webhookId: `strategy-${strategyId}`,
      webhookName: `Strategy: ${strategy.name}`,
      payload: {
        action: action,
        symbol: symbol,
        quantity: quantity,
        price: price,
        orderType: price ? 'limit' : 'market',
        strategy: strategy.name,
        timestamp: timestamp,
        rawPayload: payload,
      },
      receivedAt: timestamp,
      status: 'pending',
      source: 'strategy',
      strategyId: strategyId,
    });
    
    console.log(`✅ Webhook event stored with ID: ${eventId}`);
    
    // Get broker connection for this user (support multi-broker accounts)
    console.log(`🔍 STEP 1: Looking for Alpaca broker...`);
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    console.log(`   Found ${allBrokers?.length || 0} total brokers`);
    
    if (allBrokers && allBrokers.length > 0) {
      allBrokers.forEach((b: any, idx: number) => {
        console.log(`   Broker ${idx + 1}: id="${b.id}", type="${b.brokerType}", accountId="${b.accountId}", connected=${b.connected}`);
      });
    }
    
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    console.log(`   Found ${alpacaBrokers.length} connected Alpaca brokers`);
    
    if (alpacaBrokers.length === 0) {
      console.log('❌ Alpaca broker not connected');
      
      // Update webhook event status
      await kv.set(eventKey, {
        ...(await kv.get(eventKey)),
        status: 'error',
        error: 'Alpaca broker not connected',
      });
      
      return c.json({ error: 'Alpaca broker not connected' }, 400);
    }
    
    const brokerData = alpacaBrokers[0]; // Use first connected Alpaca broker
    console.log(`✅ Using broker: ${brokerData.name} (${brokerData.accountId})`);
    console.log(`   API Key: ${brokerData.apiKey.substring(0, 8)}...`);
    
    // ============================================
    // RISK MANAGEMENT CHECKS DISABLED
    // All orders will be executed without blocking
    // ============================================
    
    console.log('✅ Risk management disabled - all orders will execute');
    
    // ============================================
    // SYMBOL VALIDATION
    // Check if symbol is tradable on Alpaca
    // ============================================
    
    const symbolToUse = symbol.toString().toUpperCase().trim();
    console.log(`🔍 Validating symbol: ${symbolToUse}`);
    
    try {
      const assetResponse = await fetch(`https://paper-api.alpaca.markets/v2/assets/${symbolToUse}`, {
        headers: {
          'APCA-API-KEY-ID': brokerData.apiKey,
          'APCA-API-SECRET-KEY': brokerData.apiSecret,
        },
      });
      
      if (assetResponse.ok) {
        const asset = await assetResponse.json();
        console.log(`✅ Symbol ${symbolToUse} is valid and tradable:`, asset.tradable);
        
        if (!asset.tradable) {
          const errorMsg = `Symbol ${symbolToUse} exists but is not currently tradable`;
          console.log(`⚠️ ${errorMsg}`);
          
          const currentEvent = await kv.get(eventKey);
          await kv.set(eventKey, {
            ...currentEvent,
            status: 'error',
            error: errorMsg,
            reason: errorMsg,
          });
          
          return c.json({ error: errorMsg }, 400);
        }
      } else {
        console.log(`⚠️ Symbol ${symbolToUse} may not be valid, but will attempt order anyway`);
      }
    } catch (validationError) {
      console.log(`⚠️ Symbol validation failed, but will attempt order anyway:`, validationError);
    }
    
    // ============================================
    // END SYMBOL VALIDATION
    // ============================================
    
    // Execute trade through Alpaca
    const tradeId = crypto.randomUUID();
    
    // Ensure quantity is a valid integer (Alpaca requires integers for stock orders)
    const validQuantity = Math.max(1, Math.floor(parseFloat(quantity) || 1));
    
    const orderPayload: any = {
      symbol: symbolToUse,
      qty: validQuantity,
      side: action.toLowerCase() === 'buy' ? 'buy' : 'sell',
      type: price ? 'limit' : 'market',
      time_in_force: 'day',
    };
    
    if (price) {
      orderPayload.limit_price = parseFloat(price).toFixed(2);
    }
    
    console.log(`🔄 Submitting order to Alpaca:`, JSON.stringify(orderPayload, null, 2));
    
    let orderResponse: any;
    let orderResult: any;
    let attemptNumber = 1;
    let lastError = '';
    let lastErrorCode = '';
    
    const retryConfigs = [
      orderPayload,
      { ...orderPayload, type: 'market', limit_price: undefined },
      { ...orderPayload, type: 'market', time_in_force: 'ioc', limit_price: undefined },
      { ...orderPayload, type: 'market', time_in_force: 'day', extended_hours: true, limit_price: undefined },
    ];
    
    try {
      for (const retryPayload of retryConfigs) {
        console.log(`\n🔄 Attempt ${attemptNumber}:`, JSON.stringify(retryPayload, null, 2));
        
        orderResponse = await fetch('https://paper-api.alpaca.markets/v2/orders', {
          method: 'POST',
          headers: {
            'APCA-API-KEY-ID': brokerData.apiKey,
            'APCA-API-SECRET-KEY': brokerData.apiSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(retryPayload),
        });
        
        orderResult = await orderResponse.json();
        
        if (orderResponse.ok) {
          console.log(`✅ Order succeeded on attempt ${attemptNumber}!`);
          break;
        } else {
          const errorMessage = orderResult.message || orderResult.error || 'Order rejected';
          const errorCode = orderResult.code || 'unknown';
          lastError = errorMessage;
          lastErrorCode = errorCode;
          
          console.log(`❌ Attempt ${attemptNumber} failed: ${errorMessage} (${errorCode})`);
          console.log('   Response:', JSON.stringify(orderResult, null, 2));
          
          attemptNumber++;
          
          if (attemptNumber > retryConfigs.length) {
            console.log(`❌ All ${retryConfigs.length} retry attempts failed`);
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (!orderResponse.ok) {
        console.log('\n❌ FINAL FAILURE:');
        console.log('   Last error:', lastError);
        console.log('   Last error code:', lastErrorCode);
        
        const errorMessage = lastError;
        const errorCode = lastErrorCode;
        
        // Store failed trade record
        await kv.set(`user:${userId}:trade:${tradeId}`, {
          id: tradeId,
          strategyId: strategyId,
          strategyName: strategy.name,
          symbol: symbol,
          side: orderPayload.side,
          quantity: validQuantity,
          type: orderPayload.type,
          status: 'rejected',
          error: errorMessage,
          errorCode: errorCode,
          source: 'tradingview',
          timestamp: timestamp,
          brokerResponse: orderResult,
        });
        
        // Update webhook event status
        const currentEvent = await kv.get(eventKey);
        await kv.set(eventKey, {
          ...currentEvent,
          status: 'error',
          error: `${errorMessage}${errorCode !== 'unknown' ? ` (${errorCode})` : ''}`,
          reason: `${errorMessage}${errorCode !== 'unknown' ? ` (${errorCode})` : ''}`,
          tradeId: tradeId,
          attempts: attemptNumber,
        });
        
        // Create notification for rejected trade
        await createNotification(userId, {
          type: 'trade_rejected',
          title: 'Trade Rejected',
          message: `${orderPayload.side.toUpperCase()} ${quantity} ${symbol} - ${errorMessage}`,
          metadata: {
            tradeId,
            symbol,
            side: orderPayload.side,
            quantity,
            error: errorMessage,
            errorCode,
            strategyName: strategy.name,
          },
        });
        
        return c.json({ 
          error: 'Order failed', 
          details: orderResult,
          message: errorMessage,
          tradeId 
        }, 400);
      }
      
      console.log(`✅ Order submitted successfully. Order ID: ${orderResult.id}`);
      
      // Store trade record
      const tradeRecord = {
        id: tradeId,
        strategyId: strategyId,
        strategyName: strategy.name,
        symbol: symbol,
        side: orderPayload.side,
        quantity: validQuantity,
        type: orderPayload.type,
        status: orderResult.status, // 'pending', 'filled', 'accepted', etc.
        orderId: orderResult.id,
        entryPrice: orderResult.filled_avg_price || price || null,
        exitPrice: null,
        pnl: null,
        source: 'tradingview',
        submittedAt: timestamp,
        filledAt: orderResult.filled_at || null,
        broker: 'alpaca',
        brokerOrderId: orderResult.id,
        brokerResponse: orderResult,
      };
      
      await kv.set(`user:${userId}:trade:${tradeId}`, tradeRecord);
      
      // Update webhook event status
      await kv.set(eventKey, {
        ...(await kv.get(eventKey)),
        status: 'processed',
        tradeId: tradeId,
        orderId: orderResult.id,
      });
      
      console.log(`✅ Trade record stored and linked to strategy "${strategy.name}" (ID: ${strategyId})`);
      console.log(`   Trade ID: ${tradeId}`);
      console.log(`   All trades for this strategy can be viewed separately in the UI`);
      console.log('==========================================');
      
      // Create notification for successful trade
      await createNotification(userId, {
        type: 'trade_filled',
        title: 'Trade Executed',
        message: `${orderPayload.side.toUpperCase()} ${quantity} ${symbol} via ${strategy.name}`,
        metadata: {
          tradeId,
          symbol,
          side: orderPayload.side,
          quantity,
          strategyName: strategy.name,
          orderId: orderResult.id,
        },
      });
      
      return c.json({ 
        success: true, 
        tradeId,
        orderId: orderResult.id,
        status: orderResult.status,
        message: `Order submitted: ${action.toUpperCase()} ${quantity} ${symbol}`
      });
      
    } catch (brokerError) {
      console.log('❌ Error executing trade:', brokerError);
      
      // Store failed trade record
      await kv.set(`user:${userId}:trade:${tradeId}`, {
        id: tradeId,
        strategyId: strategyId,
        strategyName: strategy.name,
        symbol: symbol,
        side: orderPayload.side,
        quantity: quantity,
        type: orderPayload.type,
        status: 'error',
        error: String(brokerError),
        source: 'tradingview',
        timestamp: timestamp,
      });
      
      return c.json({ 
        error: 'Failed to execute trade', 
        details: String(brokerError),
        tradeId 
      }, 500);
    }
    
  } catch (error) {
    console.log('❌ Error processing TradingView webhook:', error);
    console.log('==========================================');
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get trades for a specific strategy
app.get('/make-server-f118884a/strategies/:id/trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    
    console.log(`📊 Fetching trades for strategy: ${strategyId}`);
    console.log(`   Total trades in DB: ${allTrades.length}`);
    
    // Filter trades for this strategy
    const strategyTrades = allTrades.filter((trade: any) => trade.strategyId === strategyId);
    
    console.log(`   Filtered trades for this strategy: ${strategyTrades.length}`);
    
    // Debug: Show first few trades with their strategyIds
    if (allTrades.length > 0 && strategyTrades.length === 0) {
      console.log(`   ⚠️ No trades matched! Showing all trade strategyIds:`);
      allTrades.slice(0, 10).forEach((t: any) => {
        console.log(`      Trade ${t.id}: strategyId="${t.strategyId}" (looking for "${strategyId}")`);
      });
    }
    
    return c.json(strategyTrades || []);
  } catch (error) {
    console.log(`Error fetching strategy trades: ${error}`);
    return c.json({ error: 'Failed to fetch trades' }, 500);
  }
});

// Sync strategy trades with Alpaca to get latest status
app.post('/make-server-f118884a/strategies/:id/sync-trades', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const strategyId = c.req.param('id');
    
    // Get broker connection (support multi-broker accounts)
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca broker not connected' }, 400);
    }
    
    const brokerData = alpacaBrokers[0];
    
    // Get all trades for this strategy
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const strategyTrades = allTrades.filter((trade: any) => trade.strategyId === strategyId);
    
    console.log(`Syncing ${strategyTrades.length} trades for strategy ${strategyId}`);
    
    let updatedCount = 0;
    let deletedCount = 0;
    
    // First, fetch all recent orders from Alpaca (last 7 days) for efficient batch update
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    try {
      const allOrdersResponse = await fetch(
        `https://paper-api.alpaca.markets/v2/orders?status=all&limit=500&after=${sevenDaysAgo.toISOString()}`,
        {
          headers: {
            'APCA-API-KEY-ID': brokerData.apiKey,
            'APCA-API-SECRET-KEY': brokerData.apiSecret,
          },
        }
      );
      
      if (allOrdersResponse.ok) {
        const allOrders = await allOrdersResponse.json();
        console.log(`📊 Fetched ${allOrders.length} orders from Alpaca`);
        
        // Create a map of broker order IDs to Alpaca order data
        const alpacaOrderMap = new Map();
        for (const order of allOrders) {
          alpacaOrderMap.set(order.id, order);
        }
        
        // Update each trade's status from Alpaca
        for (const trade of strategyTrades) {
          if (!trade.brokerOrderId) {
            // If no brokerOrderId and status is rejected/error, check if it's old
            if (['rejected', 'error', 'canceled', 'expired'].includes(trade.status)) {
              const tradeAge = new Date().getTime() - new Date(trade.submittedAt || new Date()).getTime();
              const oneDayMs = 24 * 60 * 60 * 1000;
              
              // Delete rejected/error trades older than 1 day
              if (tradeAge > oneDayMs) {
                console.log(`🗑️ Deleting old ${trade.status} trade: ${trade.id}`);
                await kv.del(`user:${userId}:trade:${trade.id}`);
                deletedCount++;
              }
            }
            continue;
          }
          
          try {
            // Check if order exists in Alpaca
            const alpacaOrder = alpacaOrderMap.get(trade.brokerOrderId);
            
            if (alpacaOrder) {
              // Update trade record with latest status from Alpaca
              const updatedTrade = {
                ...trade,
                status: alpacaOrder.status,
                entryPrice: alpacaOrder.filled_avg_price || trade.entryPrice,
                filledAt: alpacaOrder.filled_at || trade.filledAt,
                submittedAt: alpacaOrder.submitted_at || trade.submittedAt,
                brokerResponse: alpacaOrder,
              };
              
              await kv.set(`user:${userId}:trade:${trade.id}`, updatedTrade);
              updatedCount++;
              console.log(`✅ Updated trade ${trade.id} status: ${alpacaOrder.status}`);
            } else {
              // Order not found in Alpaca - might be very old or deleted
              // If it's in a terminal state (rejected, canceled, expired), delete it
              if (['rejected', 'error', 'canceled', 'expired'].includes(trade.status)) {
                console.log(`🗑️ Deleting trade not found in Alpaca: ${trade.id}`);
                await kv.del(`user:${userId}:trade:${trade.id}`);
                deletedCount++;
              }
            }
          } catch (orderError) {
            console.error(`Error processing order ${trade.brokerOrderId}:`, orderError);
          }
        }
      }
    } catch (fetchError) {
      console.error('Error fetching all orders from Alpaca, falling back to individual fetches:', fetchError);
      // Fall back to individual order fetching if batch fetch fails
      for (const trade of strategyTrades) {
        if (!trade.brokerOrderId) continue;
        
        try {
          const orderResponse = await fetch(`https://paper-api.alpaca.markets/v2/orders/${trade.brokerOrderId}`, {
            headers: {
              'APCA-API-KEY-ID': brokerData.apiKey,
              'APCA-API-SECRET-KEY': brokerData.apiSecret,
            },
          });
          
          if (orderResponse.ok) {
            const orderData = await orderResponse.json();
            const updatedTrade = {
              ...trade,
              status: orderData.status,
              entryPrice: orderData.filled_avg_price || trade.entryPrice,
              filledAt: orderData.filled_at || trade.filledAt,
              brokerResponse: orderData,
            };
            await kv.set(`user:${userId}:trade:${trade.id}`, updatedTrade);
            updatedCount++;
          }
        } catch (orderError) {
          console.error(`Error fetching order ${trade.brokerOrderId}:`, orderError);
        }
      }
    }
    
    // Now calculate P/L for matched pairs
    // Group by symbol
    const tradesBySymbol: Record<string, any[]> = {};
    const syncedTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const syncedStrategyTrades = syncedTrades.filter((trade: any) => trade.strategyId === strategyId);
    
    for (const trade of syncedStrategyTrades) {
      if (!tradesBySymbol[trade.symbol]) {
        tradesBySymbol[trade.symbol] = [];
      }
      tradesBySymbol[trade.symbol].push(trade);
    }
    
    let matchedPairs = 0;
    
    // Match buy/sell pairs for each symbol
    for (const symbol in tradesBySymbol) {
      const trades = tradesBySymbol[symbol].sort((a: any, b: any) => 
        new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
      );
      
      // Find filled buy orders without exitPrice
      const openBuys = trades.filter((t: any) => 
        t.side === 'buy' && 
        t.status === 'filled' && 
        !t.exitPrice
      );
      
      // Find filled sell orders
      const fills = trades.filter((t: any) => 
        t.side === 'sell' && 
        t.status === 'filled'
      );
      
      // Match pairs
      for (const buy of openBuys) {
        // Find a sell order that comes after this buy
        const matchingSell = fills.find((sell: any) => 
          new Date(sell.submittedAt).getTime() > new Date(buy.submittedAt).getTime() &&
          !sell.matchedBuyId // Not already matched
        );
        
        if (matchingSell && buy.entryPrice && matchingSell.entryPrice) {
          const buyPrice = parseFloat(buy.entryPrice);
          const sellPrice = parseFloat(matchingSell.entryPrice);
          const quantity = parseFloat(buy.quantity);
          const pnl = (sellPrice - buyPrice) * quantity;
          
          // Update buy order with exit info
          await kv.set(`user:${userId}:trade:${buy.id}`, {
            ...buy,
            exitPrice: sellPrice,
            pnl: pnl,
            matchedSellId: matchingSell.id,
            closedAt: matchingSell.filledAt,
          });
          
          // Mark sell order as matched
          await kv.set(`user:${userId}:trade:${matchingSell.id}`, {
            ...matchingSell,
            matchedBuyId: buy.id,
            pnl: pnl,
          });
          
          matchedPairs++;
        }
      }
    }
    
    console.log(`✅ Sync complete: ${updatedCount} trades updated, ${matchedPairs} pairs matched, ${deletedCount} old trades deleted`);
    
    // Return updated trades
    const finalTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const finalStrategyTrades = finalTrades.filter((trade: any) => trade.strategyId === strategyId);
    
    return c.json({ 
      success: true, 
      updated: updatedCount,
      matched: matchedPairs,
      deleted: deletedCount,
      trades: finalStrategyTrades 
    });
  } catch (error) {
    console.log(`Error syncing strategy trades: ${error}`);
    return c.json({ error: 'Failed to sync trades' }, 500);
  }
});

// ============================================
// WEBHOOK ROUTES
// ============================================

// Global sync all trades endpoint - syncs ALL user trades across all strategies
app.post('/make-server-f118884a/trades/sync-all', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Get broker connection (support multi-broker accounts)
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca broker not connected' }, 400);
    }
    
    const brokerData = alpacaBrokers[0];
    
    console.log(`🔄 Starting global trade sync for user ${userId}`);
    
    // Get all user trades
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    console.log(`📊 Found ${allTrades.length} total trades to sync`);
    
    let updatedCount = 0;
    let deletedCount = 0;
    let matchedPairs = 0;
    
    // Fetch all recent orders from Alpaca (last 30 days for global sync)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    try {
      const allOrdersResponse = await fetch(
        `https://paper-api.alpaca.markets/v2/orders?status=all&limit=500&after=${thirtyDaysAgo.toISOString()}`,
        {
          headers: {
            'APCA-API-KEY-ID': brokerData.apiKey,
            'APCA-API-SECRET-KEY': brokerData.apiSecret,
          },
        }
      );
      
      if (allOrdersResponse.ok) {
        const allOrders = await allOrdersResponse.json();
        console.log(`📊 Fetched ${allOrders.length} orders from Alpaca`);
        
        // Create a map of broker order IDs to Alpaca order data
        const alpacaOrderMap = new Map();
        for (const order of allOrders) {
          alpacaOrderMap.set(order.id, order);
        }
        
        // Update each trade's status from Alpaca
        for (const trade of allTrades) {
          if (!trade.brokerOrderId) {
            // If no brokerOrderId and status is rejected/error, check if it's old
            if (['rejected', 'error', 'canceled', 'expired'].includes(trade.status)) {
              const tradeAge = new Date().getTime() - new Date(trade.submittedAt || new Date()).getTime();
              const oneDayMs = 24 * 60 * 60 * 1000;
              
              // Delete rejected/error trades older than 1 day
              if (tradeAge > oneDayMs) {
                console.log(`🗑️ Deleting old ${trade.status} trade: ${trade.id}`);
                await kv.del(`user:${userId}:trade:${trade.id}`);
                deletedCount++;
              }
            }
            continue;
          }
          
          try {
            const alpacaOrder = alpacaOrderMap.get(trade.brokerOrderId);
            
            if (alpacaOrder) {
              // Update trade record with latest status from Alpaca
              const updatedTrade = {
                ...trade,
                status: alpacaOrder.status,
                entryPrice: alpacaOrder.filled_avg_price || trade.entryPrice,
                filledAt: alpacaOrder.filled_at || trade.filledAt,
                submittedAt: alpacaOrder.submitted_at || trade.submittedAt,
                brokerResponse: alpacaOrder,
              };
              
              await kv.set(`user:${userId}:trade:${trade.id}`, updatedTrade);
              updatedCount++;
            } else {
              // Order not found in Alpaca
              if (['rejected', 'error', 'canceled', 'expired'].includes(trade.status)) {
                console.log(`🗑️ Deleting trade not found in Alpaca: ${trade.id}`);
                await kv.del(`user:${userId}:trade:${trade.id}`);
                deletedCount++;
              }
            }
          } catch (orderError) {
            console.error(`Error processing order ${trade.brokerOrderId}:`, orderError);
          }
        }
      }
    } catch (fetchError) {
      console.error('Error fetching orders from Alpaca:', fetchError);
      return c.json({ error: 'Failed to fetch orders from Alpaca' }, 500);
    }
    
    // Match buy/sell pairs for P&L calculation
    const updatedTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const filledTrades = updatedTrades.filter((t: any) => t.status === 'filled');
    
    // Group by symbol for matching
    const tradesBySymbol = new Map();
    for (const trade of filledTrades) {
      if (!tradesBySymbol.has(trade.symbol)) {
        tradesBySymbol.set(trade.symbol, []);
      }
      tradesBySymbol.get(trade.symbol).push(trade);
    }
    
    // Match buy/sell pairs for each symbol
    for (const [symbol, trades] of tradesBySymbol) {
      const buyOrders = trades.filter((t: any) => t.side === 'buy');
      const sellOrders = trades.filter((t: any) => t.side === 'sell');
      
      for (const buy of buyOrders) {
        if (buy.matchedSellId) continue; // Already matched
        
        const matchingSell = sellOrders.find((sell: any) => 
          !sell.matchedBuyId &&
          new Date(sell.submittedAt).getTime() > new Date(buy.submittedAt).getTime()
        );
        
        if (matchingSell && buy.entryPrice && matchingSell.entryPrice) {
          const buyPrice = parseFloat(buy.entryPrice);
          const sellPrice = parseFloat(matchingSell.entryPrice);
          const quantity = parseFloat(buy.quantity);
          const pnl = (sellPrice - buyPrice) * quantity;
          
          await kv.set(`user:${userId}:trade:${buy.id}`, {
            ...buy,
            exitPrice: sellPrice,
            pnl: pnl,
            matchedSellId: matchingSell.id,
            closedAt: matchingSell.filledAt,
          });
          
          await kv.set(`user:${userId}:trade:${matchingSell.id}`, {
            ...matchingSell,
            matchedBuyId: buy.id,
            pnl: pnl,
          });
          
          matchedPairs++;
        }
      }
    }
    
    console.log(`✅ Global sync complete: ${updatedCount} updated, ${matchedPairs} matched, ${deletedCount} deleted`);
    
    return c.json({ 
      success: true, 
      updated: updatedCount,
      matched: matchedPairs,
      deleted: deletedCount,
    });
  } catch (error) {
    console.error(`Error in global trade sync: ${error}`);
    return c.json({ error: 'Failed to sync trades' }, 500);
  }
});

// Portfolio analytics endpoint - calculates comprehensive performance metrics
app.get('/make-server-f118884a/analytics/portfolio', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    console.log(`📊 Calculating portfolio analytics for user ${userId}`);
    
    // Get all trades
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    const filledTrades = allTrades.filter((t: any) => t.status === 'filled');
    
    // Calculate basic metrics
    const totalTrades = filledTrades.length;
    const closedTrades = filledTrades.filter((t: any) => t.pnl !== null && t.pnl !== undefined);
    
    let totalPnL = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;
    const pnlArray: number[] = [];
    
    for (const trade of closedTrades) {
      const pnl = parseFloat(trade.pnl || 0);
      totalPnL += pnl;
      pnlArray.push(pnl);
      
      if (pnl > 0) {
        winningTrades++;
        totalWinAmount += pnl;
      } else if (pnl < 0) {
        losingTrades++;
        totalLossAmount += Math.abs(pnl);
      }
    }
    
    const winRate = closedTrades.length > 0 ? (winningTrades / closedTrades.length) * 100 : 0;
    const avgWin = winningTrades > 0 ? totalWinAmount / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? totalLossAmount / losingTrades : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 0;
    
    // Calculate Sharpe Ratio (simplified - using daily returns)
    let sharpeRatio = 0;
    if (pnlArray.length > 1) {
      const avgReturn = pnlArray.reduce((a, b) => a + b, 0) / pnlArray.length;
      const variance = pnlArray.reduce((sum, val) => sum + Math.pow(val - avgReturn, 2), 0) / pnlArray.length;
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
    }
    
    // Calculate Max Drawdown
    let maxDrawdown = 0;
    let peak = 0;
    let runningPnL = 0;
    
    const sortedTrades = closedTrades.sort((a: any, b: any) => 
      new Date(a.closedAt || a.filledAt).getTime() - new Date(b.closedAt || b.filledAt).getTime()
    );
    
    for (const trade of sortedTrades) {
      runningPnL += parseFloat(trade.pnl || 0);
      if (runningPnL > peak) {
        peak = runningPnL;
      }
      const drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    
    // Get strategy breakdown
    const strategies = await kv.getByPrefix(`user:${userId}:strategy:`);
    const strategyMetrics = strategies.map((strategy: any) => {
      const strategyTrades = closedTrades.filter((t: any) => t.strategyId === strategy.id);
      const strategyPnL = strategyTrades.reduce((sum: number, t: any) => sum + parseFloat(t.pnl || 0), 0);
      const strategyWins = strategyTrades.filter((t: any) => parseFloat(t.pnl || 0) > 0).length;
      const strategyWinRate = strategyTrades.length > 0 ? (strategyWins / strategyTrades.length) * 100 : 0;
      
      return {
        id: strategy.id,
        name: strategy.name,
        totalTrades: strategyTrades.length,
        pnl: strategyPnL,
        winRate: strategyWinRate,
      };
    });
    
    // Calculate daily P&L for the last 30 days
    const dailyPnL: { date: string; pnl: number }[] = [];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentTrades = closedTrades.filter((t: any) => {
      const tradeDate = new Date(t.closedAt || t.filledAt);
      return tradeDate >= thirtyDaysAgo;
    });
    
    const tradesByDate = new Map();
    for (const trade of recentTrades) {
      const dateStr = new Date(trade.closedAt || trade.filledAt).toISOString().split('T')[0];
      if (!tradesByDate.has(dateStr)) {
        tradesByDate.set(dateStr, 0);
      }
      tradesByDate.set(dateStr, tradesByDate.get(dateStr) + parseFloat(trade.pnl || 0));
    }
    
    for (const [date, pnl] of tradesByDate) {
      dailyPnL.push({ date, pnl });
    }
    dailyPnL.sort((a, b) => a.date.localeCompare(b.date));
    
    return c.json({
      totalTrades,
      closedTrades: closedTrades.length,
      openTrades: filledTrades.length - closedTrades.length,
      totalPnL,
      winningTrades,
      losingTrades,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      strategyMetrics,
      dailyPnL,
    });
  } catch (error) {
    console.error(`Error calculating portfolio analytics: ${error}`);
    return c.json({ error: 'Failed to calculate analytics' }, 500);
  }
});

app.get('/make-server-f118884a/webhooks', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const webhooks = await kv.getByPrefix(`user:${userId}:webhook:`);
    return c.json(webhooks || []);
  } catch (error) {
    console.log(`Error fetching webhooks: ${error}`);
    return c.json({ error: 'Failed to fetch webhooks' }, 500);
  }
});

app.post('/make-server-f118884a/webhooks', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const webhook = await c.req.json();
    const webhookId = crypto.randomUUID();
    const webhookToken = crypto.randomUUID();
    
    // Get the strategy to link this webhook to
    let strategyData = null;
    let strategyName = webhook.strategy || 'Unnamed Strategy';
    
    if (webhook.strategyId) {
      strategyData = await kv.get(`user:${userId}:strategy:${webhook.strategyId}`);
      if (strategyData) {
        strategyName = strategyData.name;
      }
    }
    
    // Get the Supabase project URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    
    // Extract just the hostname (e.g., "muebztvqnsrvhtnnwdqx.supabase.co")
    const hostname = supabaseUrl.replace(/^https?:\/\//, '');
    
    // Use the webhook-receiver endpoint in the main server function
    // This is a public endpoint that validates using the token parameter
    const webhookUrl = `https://${hostname}/functions/v1/make-server-f118884a/webhook-receiver?token=${webhookToken}`;
    
    console.log(`Creating webhook with URL: ${webhookUrl}`);
    console.log(`  Linked to strategy: ${strategyName} (ID: ${webhook.strategyId || 'none'})`);
    
    await kv.set(`user:${userId}:webhook:${webhookId}`, {
      ...webhook,
      id: webhookId,
      token: webhookToken,
      userId,
      url: webhookUrl,
      strategy: strategyName, // Keep for display
      strategyId: webhook.strategyId || null, // Store the strategy ID for trade linking
      createdAt: new Date().toISOString(),
      triggers: 0,
      successRate: 100,
    });
    
    // Store reverse lookup for webhook token
    await kv.set(`webhook-token:${webhookToken}`, { userId, webhookId });
    
    return c.json({ success: true, webhookId, token: webhookToken });
  } catch (error) {
    console.log(`Error creating webhook: ${error}`);
    return c.json({ error: 'Failed to create webhook' }, 500);
  }
});

// Webhook receiver endpoint - receives trade signals from external platforms
// Format: POST /webhook/:token
// The token parameter is used to identify which user's webhook this is
app.post('/make-server-f118884a/webhook/:token', async (c) => {
  const token = c.req.param('token');
  const payload = await c.req.json();
  
  console.log(`📥 Webhook received with token: ${token}`);
  console.log('Payload:', JSON.stringify(payload, null, 2));
  
  // Look up user by webhook token
  const webhookConfig = await kv.get(`webhook:${token}`);
  
  if (!webhookConfig) {
    console.log('❌ Invalid webhook token');
    return c.json({ error: 'Invalid webhook token' }, 404);
  }
  
  const userId = (webhookConfig as any).userId;
  console.log('✅ Webhook validated for user:', userId);
  
  // Store the webhook event
  const webhookEvents = await kv.get(`user:${userId}:webhook-events`) || [];
  const newEvent = {
    id: crypto.randomUUID(),
    payload,
    receivedAt: new Date().toISOString(),
    processed: false,
  };
  
  (webhookEvents as any[]).push(newEvent);
  await kv.set(`user:${userId}:webhook-events`, webhookEvents);
  
  console.log('✅ Webhook event stored');
  
  // Process the webhook (e.g., execute trade)
  // For now, just log it
  console.log('Processing webhook event:', newEvent.id);
  
  return c.json({ 
    success: true, 
    message: 'Webhook received and processed',
    eventId: newEvent.id,
  });
});

// Get ALL webhook events for a user (not filtered by webhook ID)
app.get('/make-server-f118884a/webhooks/all/events', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    console.log('========== FETCHING ALL EVENTS ==========');
    console.log('📊 User ID:', userId);
    console.log('🔍 Looking for events with prefix:', `user:${userId}:webhook-event:`);
    
    const events = await kv.getByPrefix(`user:${userId}:webhook-event:`);
    
    console.log(`✅ Found ${events?.length || 0} total raw events`);
    
    // Log the first few events for debugging
    if (events && events.length > 0) {
      console.log('Sample events (first 3):');
      events.slice(0, 3).forEach((event: any, idx: number) => {
        console.log(`  Event ${idx + 1}:`, {
          id: event.id,
          webhookName: event.webhookName,
          receivedAt: event.receivedAt,
          status: event.status,
        });
      });
    }
    
    // Transform events to include timestamp and error fields for frontend display
    const transformedEvents = (events || []).map((event: any) => ({
      ...event,
      timestamp: event.receivedAt, // Map receivedAt to timestamp for frontend compatibility
      webhook: event.webhookName || 'Unknown',
      error: event.status === 'failed' || event.status === 'no_broker' 
        ? (event.execution?.error || 'Trade execution failed')
        : null,
    }));
    
    console.log(`📤 Returning ${transformedEvents.length} transformed events`);
    console.log('========== END FETCHING EVENTS ==========');
    
    return c.json(transformedEvents);
  } catch (error) {
    console.log(`❌ Error fetching all webhook events: ${error}`);
    return c.json({ error: 'Failed to fetch events' }, 500);
  }
});

app.get('/make-server-f118884a/webhooks/:id/events', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const events = await kv.getByPrefix(`user:${userId}:webhook-event:`);
    
    // Transform events to include timestamp and error fields for frontend display
    const transformedEvents = (events || []).map((event: any) => ({
      ...event,
      timestamp: event.receivedAt, // Map receivedAt to timestamp for frontend compatibility
      webhook: event.webhookName || 'Unknown',
      error: event.status === 'failed' || event.status === 'no_broker' 
        ? (event.execution?.error || 'Trade execution failed')
        : null,
    }));
    
    return c.json(transformedEvents);
  } catch (error) {
    console.log(`Error fetching webhook events: ${error}`);
    return c.json({ error: 'Failed to fetch events' }, 500);
  }
});

// Backfill webhook events from existing trades (one-time migration)
app.post('/make-server-f118884a/backfill-webhook-events', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    console.log('========== BACKFILLING WEBHOOK EVENTS ==========');
    console.log('📊 User ID:', userId);
    
    // Get all trades for this user
    const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
    console.log(`Found ${allTrades.length} total trades`);
    
    // Filter trades that have a strategyId and source='tradingview' but no webhook event
    const strategyTrades = allTrades.filter((trade: any) => 
      trade.strategyId && trade.source === 'tradingview'
    );
    console.log(`Found ${strategyTrades.length} strategy trades`);
    
    // Get existing webhook events to avoid duplicates
    const existingEvents = await kv.getByPrefix(`user:${userId}:webhook-event:`);
    const existingTradeIds = new Set(
      existingEvents
        .filter((e: any) => e.tradeId)
        .map((e: any) => e.tradeId)
    );
    console.log(`Found ${existingTradeIds.size} existing webhook events with trade IDs`);
    
    // Create webhook events for trades that don't have them
    let created = 0;
    for (const trade of strategyTrades) {
      if (!existingTradeIds.has(trade.id)) {
        // Get strategy info
        const strategy = await kv.get(`user:${userId}:strategy:${trade.strategyId}`);
        
        const eventId = crypto.randomUUID();
        const eventKey = `user:${userId}:webhook-event:${eventId}`;
        
        await kv.set(eventKey, {
          id: eventId,
          webhookId: `strategy-${trade.strategyId}`,
          webhookName: `Strategy: ${trade.strategyName || strategy?.name || 'Unknown'}`,
          payload: {
            action: trade.side,
            symbol: trade.symbol,
            quantity: trade.quantity,
            price: trade.entryPrice,
            orderType: trade.type,
            strategy: trade.strategyName || strategy?.name || 'Unknown',
            timestamp: trade.submittedAt || trade.timestamp,
            rawPayload: { backfilled: true },
          },
          receivedAt: trade.submittedAt || trade.timestamp,
          status: trade.status === 'rejected' ? 'error' : 'processed',
          error: trade.error || null,
          source: 'strategy',
          strategyId: trade.strategyId,
          tradeId: trade.id,
          orderId: trade.orderId || trade.brokerOrderId,
          backfilled: true,
        });
        
        created++;
      }
    }
    
    console.log(`✅ Created ${created} webhook events`);
    console.log('========== BACKFILL COMPLETE ==========');
    
    return c.json({ 
      success: true, 
      tradesFound: allTrades.length,
      strategyTrades: strategyTrades.length,
      eventsCreated: created,
      message: `Backfilled ${created} webhook events from existing trades`
    });
  } catch (error) {
    console.log(`❌ Error backfilling webhook events: ${error}`);
    return c.json({ error: 'Failed to backfill events' }, 500);
  }
});

app.delete('/make-server-f118884a/webhooks/:id', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const webhookId = c.req.param('id');
    const webhook = await kv.get(`user:${userId}:webhook:${webhookId}`);
    
    if (webhook && webhook.token) {
      await kv.del(`webhook-token:${webhook.token}`);
    }
    
    await kv.del(`user:${userId}:webhook:${webhookId}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error deleting webhook: ${error}`);
    return c.json({ error: 'Failed to delete webhook' }, 500);
  }
});

// ============================================
// NOTIFICATION ROUTES
// ============================================

app.get('/make-server-f118884a/notifications', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notifications = await kv.getByPrefix(`user:${userId}:notification:`);
    return c.json(notifications || []);
  } catch (error) {
    console.log(`Error fetching notifications: ${error}`);
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }
});

app.post('/make-server-f118884a/notifications', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notification = await c.req.json();
    const notificationId = crypto.randomUUID();
    
    await kv.set(`user:${userId}:notification:${notificationId}`, {
      ...notification,
      id: notificationId,
      userId,
      read: false,
      createdAt: new Date().toISOString(),
    });
    
    return c.json({ success: true, notificationId });
  } catch (error) {
    console.log(`Error creating notification: ${error}`);
    return c.json({ error: 'Failed to create notification' }, 500);
  }
});

app.put('/make-server-f118884a/notifications/:id/read', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notificationId = c.req.param('id');
    const notification = await kv.get(`user:${userId}:notification:${notificationId}`);
    
    if (!notification) {
      return c.json({ error: 'Notification not found' }, 404);
    }
    
    await kv.set(`user:${userId}:notification:${notificationId}`, {
      ...notification,
      read: true,
    });
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error marking notification as read: ${error}`);
    return c.json({ error: 'Failed to update notification' }, 500);
  }
});

app.get('/make-server-f118884a/notifications/preferences', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const preferences = await kv.get(`user:${userId}:notification-preferences`);
    return c.json(preferences || {
      email: true,
      push: true,
      sms: false,
      tradeAlerts: true,
      priceAlerts: true,
      strategyAlerts: true,
      systemAlerts: true,
    });
  } catch (error) {
    console.log(`Error fetching notification preferences: ${error}`);
    return c.json({ error: 'Failed to fetch preferences' }, 500);
  }
});

app.put('/make-server-f118884a/notifications/preferences', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const preferences = await c.req.json();
    await kv.set(`user:${userId}:notification-preferences`, preferences);
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error updating notification preferences: ${error}`);
    return c.json({ error: 'Failed to update preferences' }, 500);
  }
});

// ============================================
// BROKER ROUTES
// ============================================

app.get('/make-server-f118884a/brokers', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const brokers = await kv.getByPrefix(`user:${userId}:broker:`);
    console.log(`📊 GET /brokers - User ${userId} - Found ${brokers?.length || 0} brokers`);
    if (brokers && brokers.length > 0) {
      brokers.forEach((b: any, idx: number) => {
        console.log(`  Broker ${idx + 1}: id="${b.id}", brokerType="${b.brokerType}", accountId="${b.accountId}"`);
      });
    }
    return c.json(brokers || []);
  } catch (error) {
    console.log(`Error fetching brokers: ${error}`);
    return c.json({ error: 'Failed to fetch brokers' }, 500);
  }
});

app.post('/make-server-f118884a/brokers', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const { brokerId, name, apiKey, apiSecret } = await c.req.json();
    
    // Validate credentials with Alpaca API
    if (brokerId === 'alpaca') {
      try {
        // Call Alpaca API to validate and get account info
        const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/account', {
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': apiSecret,
          },
        });

        if (!alpacaResponse.ok) {
          const errorData = await alpacaResponse.json().catch(() => ({}));
          console.log(`Alpaca API error: ${JSON.stringify(errorData)}`);
          return c.json({ error: 'Invalid Alpaca credentials' }, 400);
        }

        const accountData = await alpacaResponse.json();
        
        // Generate unique ID for this broker account (allows multiple accounts per broker type)
        const uniqueBrokerId = `${brokerId}:${accountData.account_number}`;
        
        // Store the broker connection with FULL credentials (encrypted in production!)
        await kv.set(`user:${userId}:broker:${uniqueBrokerId}`, {
          id: uniqueBrokerId,
          brokerType: brokerId,
          name,
          connected: true,
          accountId: accountData.account_number,
          status: accountData.status,
          // Store FULL credentials - in production, these should be encrypted!
          apiKey: apiKey,
          apiSecret: apiSecret,
          connectedAt: new Date().toISOString(),
          accountData: {
            equity: parseFloat(accountData.equity),
            cash: parseFloat(accountData.cash),
            buyingPower: parseFloat(accountData.buying_power),
            portfolioValue: parseFloat(accountData.portfolio_value),
          },
        });
        
        return c.json({ success: true, accountId: accountData.account_number });
      } catch (apiError) {
        console.log(`Error calling Alpaca API: ${apiError}`);
        return c.json({ error: 'Failed to connect to Alpaca. Please check your credentials.' }, 400);
      }
    }
    
    // For other brokers, store full credentials (in production, encrypt these!)
    // TODO: Add proper API validation for Interactive Brokers and TD Ameritrade
    const placeholderAccountId = `${brokerId}_${Date.now()}`;
    const uniqueBrokerId = `${brokerId}:${placeholderAccountId}`;
    
    await kv.set(`user:${userId}:broker:${uniqueBrokerId}`, {
      id: uniqueBrokerId,
      brokerType: brokerId,
      name,
      connected: true,
      accountId: placeholderAccountId,
      status: 'ACTIVE',
      // Store FULL credentials for multi-broker support
      apiKey: apiKey,
      apiSecret: apiSecret,
      connectedAt: new Date().toISOString(),
      accountData: {
        // Placeholder data - real data would come from broker API
        equity: 0,
        cash: 0,
        buyingPower: 0,
        portfolioValue: 0,
      },
    });
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error connecting broker: ${error}`);
    return c.json({ error: 'Failed to connect broker' }, 500);
  }
});

app.delete('/make-server-f118884a/brokers/:id', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const brokerId = c.req.param('id');
    await kv.del(`user:${userId}:broker:${brokerId}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.log(`Error disconnecting broker: ${error}`);
    return c.json({ error: 'Failed to disconnect broker' }, 500);
  }
});

// Get Alpaca account data
app.get('/make-server-f118884a/alpaca/account', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Get broker ID from query parameter (for multi-account support)
    const brokerId = c.req.query('brokerId');
    
    let broker;
    if (brokerId) {
      // Specific broker requested
      broker = await kv.get(`user:${userId}:broker:${brokerId}`);
    } else {
      // No specific broker - find first connected Alpaca broker
      const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
      broker = allBrokers.find((b: any) => 
        (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:')))
        && b.connected
      );
    }
    
    if (!broker || !broker.apiKey) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/account', {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json({ error: 'Failed to fetch Alpaca account' }, 400);
    }
    
    const accountData = await alpacaResponse.json();
    return c.json(accountData);
  } catch (error) {
    console.log(`Error fetching Alpaca account: ${error}`);
    return c.json({ error: 'Failed to fetch account data' }, 500);
  }
});

// Get Alpaca positions
app.get('/make-server-f118884a/alpaca/positions', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Get broker ID from query parameter (for multi-account support)
    const brokerId = c.req.query('brokerId');
    
    let broker;
    if (brokerId) {
      broker = await kv.get(`user:${userId}:broker:${brokerId}`);
    } else {
      // No specific broker - find first connected Alpaca broker
      const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
      broker = allBrokers.find((b: any) => 
        (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:')))
        && b.connected
      );
    }
    
    if (!broker || !broker.apiKey) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    const alpacaResponse = await fetch('https://paper-api.alpaca.markets/v2/positions', {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json([]);
    }
    
    const positions = await alpacaResponse.json();
    return c.json(positions);
  } catch (error) {
    console.log(`Error fetching Alpaca positions: ${error}`);
    return c.json({ error: 'Failed to fetch positions' }, 500);
  }
});

// Get Alpaca portfolio history for equity curve
app.get('/make-server-f118884a/alpaca/portfolio-history', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Get broker ID from query parameter (for multi-account support)
    const brokerId = c.req.query('brokerId');
    
    let broker;
    if (brokerId) {
      broker = await kv.get(`user:${userId}:broker:${brokerId}`);
    } else {
      // No specific broker - find first connected Alpaca broker
      const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
      broker = allBrokers.find((b: any) => 
        (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:')))
        && b.connected
      );
    }
    
    if (!broker || !broker.apiKey) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    // Get portfolio history with parameters
    const period = c.req.query('period') || '1M';
    const timeframe = c.req.query('timeframe') || '1D';
    const startDate = c.req.query('start_date');
    const endDate = c.req.query('end_date');
    
    let url = `https://paper-api.alpaca.markets/v2/account/portfolio/history?timeframe=${timeframe}`;
    
    if (startDate && endDate) {
      url += `&start=${startDate}&end=${endDate}`;
    } else {
      url += `&period=${period}`;
    }
    
    const alpacaResponse = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json({ equity: [], timestamp: [], profit_loss: [], profit_loss_pct: [], base_value: 0, timeframe: '1D' });
    }
    
    const history = await alpacaResponse.json();
    return c.json(history);
  } catch (error) {
    console.log(`Error fetching Alpaca portfolio history: ${error}`);
    return c.json({ error: 'Failed to fetch portfolio history' }, 500);
  }
});

// Get Alpaca orders (for trades history)
app.get('/make-server-f118884a/alpaca/orders', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Get broker ID from query parameter (for multi-account support)
    const brokerId = c.req.query('brokerId');
    
    let broker;
    if (brokerId) {
      broker = await kv.get(`user:${userId}:broker:${brokerId}`);
    } else {
      // No specific broker - find first connected Alpaca broker
      const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
      broker = allBrokers.find((b: any) => 
        (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:')))
        && b.connected
      );
    }
    
    if (!broker || !broker.apiKey) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    // Get all closed orders (filled, partially_filled, etc.)
    // status can be: open, closed, all
    // Default to 'all' to show both open and closed orders
    const status = c.req.query('status') || 'closed';
    const limit = c.req.query('limit') || '500'; // Default to last 500 orders
    
    const alpacaResponse = await fetch(`https://paper-api.alpaca.markets/v2/orders?status=${status}&limit=${limit}&direction=desc`, {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      const errorData = await alpacaResponse.json().catch(() => ({}));
      console.log('Alpaca orders fetch error:', errorData);
      return c.json([]);
    }
    
    const orders = await alpacaResponse.json();
    
    console.log(`📊 Fetched ${orders.length} orders from Alpaca (status=${status}, limit=${limit})`);
    if (orders.length > 0) {
      console.log(`   First order sample:`, {
        id: orders[0].id?.slice(0, 8),
        symbol: orders[0].symbol,
        side: orders[0].side,
        status: orders[0].status,
        submitted_at: orders[0].submitted_at,
        filled_at: orders[0].filled_at,
        created_at: orders[0].created_at,
        updated_at: orders[0].updated_at,
      });
    }
    
    // Transform orders to include calculated P&L and return %
    const transformedOrders = orders.map((order: any) => {
      const filledQty = parseFloat(order.filled_qty || 0);
      const filledAvgPrice = parseFloat(order.filled_avg_price || 0);
      const limitPrice = parseFloat(order.limit_price || 0);
      
      // For now, we'll mark exit as null since these are open positions
      // In a real scenario, you'd match buy/sell pairs to calculate realized P&L
      return {
        ...order,
        qty: filledQty || parseFloat(order.qty || 0),
        entry: filledAvgPrice,
        exit: null, // Would need to match with closing order
        pnl: null, // Would calculate from entry/exit
        return: null, // Would calculate percentage return
      };
    });
    
    return c.json(transformedOrders);
  } catch (error) {
    console.log(`Error fetching Alpaca orders: ${error}`);
    return c.json({ error: 'Failed to fetch orders' }, 500);
  }
});

// Get Alpaca account activities (for P&L calculations)
app.get('/make-server-f118884a/alpaca/activities', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Support multi-broker accounts
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    const broker = alpacaBrokers[0];
    
    // Get account activities (trades, fills, etc.)
    const activityType = c.req.query('activity_types') || 'FILL';
    const alpacaResponse = await fetch(`https://paper-api.alpaca.markets/v2/account/activities?activity_types=${activityType}`, {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json([]);
    }
    
    const activities = await alpacaResponse.json();
    return c.json(activities);
  } catch (error) {
    console.log(`Error fetching Alpaca activities: ${error}`);
    return c.json({ error: 'Failed to fetch activities' }, 500);
  }
});

// Get current price quote for a symbol
app.get('/make-server-f118884a/alpaca/quote/:symbol', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Support multi-broker accounts
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    const broker = alpacaBrokers[0];
    
    const symbol = c.req.param('symbol');
    const alpacaResponse = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`, {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json({ error: 'Failed to fetch quote' }, 404);
    }
    
    const quote = await alpacaResponse.json();
    return c.json(quote);
  } catch (error) {
    console.log(`Error fetching quote: ${error}`);
    return c.json({ error: 'Failed to fetch quote' }, 500);
  }
});

// Get multiple quotes at once
app.post('/make-server-f118884a/alpaca/quotes', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    // Support multi-broker accounts
    const allBrokers = await kv.getByPrefix(`user:${userId}:broker:`);
    const alpacaBrokers = allBrokers?.filter((b: any) => {
      return (b.brokerType === 'alpaca' || b.id === 'alpaca' || (typeof b.id === 'string' && b.id.startsWith('alpaca:'))) 
        && b.connected 
        && b.apiKey 
        && b.apiSecret;
    }) || [];
    
    if (alpacaBrokers.length === 0) {
      return c.json({ error: 'Alpaca not connected' }, 404);
    }
    
    const broker = alpacaBrokers[0];
    
    const body = await c.req.json();
    const symbols = body.symbols || [];
    
    if (symbols.length === 0) {
      return c.json({});
    }
    
    // Fetch quotes for all symbols
    const symbolsParam = symbols.join(',');
    const alpacaResponse = await fetch(`https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${symbolsParam}`, {
      headers: {
        'APCA-API-KEY-ID': broker.apiKey,
        'APCA-API-SECRET-KEY': broker.apiSecret,
      },
    });
    
    if (!alpacaResponse.ok) {
      return c.json({});
    }
    
    const quotes = await alpacaResponse.json();
    return c.json(quotes);
  } catch (error) {
    console.log(`Error fetching quotes: ${error}`);
    return c.json({ error: 'Failed to fetch quotes' }, 500);
  }
});

// Test webhook endpoint - proxies request to webhook-receiver
app.post('/make-server-f118884a/test-webhook', async (c) => {
  try {
    const body = await c.req.json();
    const { webhookUrl, payload } = body;
    
    console.log('========== TEST WEBHOOK DEBUG ==========');
    console.log('Step 1: Received test request');
    console.log('Webhook URL:', webhookUrl);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    
    // Make request to webhook endpoint (which is in the SAME server now)
    console.log('Step 2: Sending POST to webhook URL...');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    const responseText = await response.text();
    console.log('Step 3: Response received');
    console.log('Webhook response status:', response.status);
    console.log('Webhook response body:', responseText);
    console.log('========== END DEBUG ==========');
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { rawResponse: responseText };
    }
    
    return c.json({
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      data: responseData,
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    return c.json({
      error: true,
      type: 'Network/CORS Error',
      message: String(error),
    }, 500);
  }
});

// ============================================
// NOTIFICATIONS SYSTEM API
// ============================================

// Get all notifications for a user
app.get('/make-server-f118884a/notifications', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notifications = await kv.getByPrefix(`user:${userId}:notification:`);
    
    // Sort by timestamp/createdAt (newest first)
    const sorted = notifications.sort((a: any, b: any) => {
      const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });
    
    return c.json(sorted);
  } catch (error) {
    console.error(`Error fetching notifications: ${error}`);
    return c.json({ error: 'Failed to fetch notifications' }, 500);
  }
});

// Mark notification as read
app.patch('/make-server-f118884a/notifications/:id/read', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notificationId = c.req.param('id');
    const notification = await kv.get(`user:${userId}:notification:${notificationId}`);
    
    if (!notification) {
      return c.json({ error: 'Notification not found' }, 404);
    }
    
    await kv.set(`user:${userId}:notification:${notificationId}`, {
      ...notification,
      read: true,
    });
    
    return c.json({ success: true });
  } catch (error) {
    console.error(`Error marking notification as read: ${error}`);
    return c.json({ error: 'Failed to update notification' }, 500);
  }
});

// Mark all notifications as read
app.post('/make-server-f118884a/notifications/mark-all-read', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notifications = await kv.getByPrefix(`user:${userId}:notification:`);
    
    for (const notif of notifications) {
      if (!notif.read) {
        await kv.set(`user:${userId}:notification:${notif.id}`, {
          ...notif,
          read: true,
        });
      }
    }
    
    return c.json({ success: true, count: notifications.length });
  } catch (error) {
    console.error(`Error marking all notifications as read: ${error}`);
    return c.json({ error: 'Failed to update notifications' }, 500);
  }
});

// Delete a notification
app.delete('/make-server-f118884a/notifications/:id', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const notificationId = c.req.param('id');
    await kv.del(`user:${userId}:notification:${notificationId}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.error(`Error deleting notification: ${error}`);
    return c.json({ error: 'Failed to delete notification' }, 500);
  }
});

// Get/update notification settings
app.get('/make-server-f118884a/notification-settings', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const settings = await kv.get(`user:${userId}:notification-settings`) || {
      emailEnabled: true,
      pushEnabled: true,
      smsEnabled: false,
      tradeAlerts: true,
      priceAlerts: true,
      strategyAlerts: true,
      systemAlerts: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    };
    
    return c.json(settings);
  } catch (error) {
    console.error(`Error fetching notification settings: ${error}`);
    return c.json({ error: 'Failed to fetch settings' }, 500);
  }
});

app.post('/make-server-f118884a/notification-settings', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const settings = await c.req.json();
    await kv.set(`user:${userId}:notification-settings`, settings);
    
    return c.json({ success: true });
  } catch (error) {
    console.error(`Error saving notification settings: ${error}`);
    return c.json({ error: 'Failed to save settings' }, 500);
  }
});

// ============================================
// MCP (Model Context Protocol) ENDPOINTS
// These endpoints enable AI assistants (Claude, Cursor AI, etc.) to interact
// with AlgoFin.ai through natural language commands
// ============================================

// List available MCP tools
app.get('/make-server-f118884a/mcp/tools', async (c) => {
  try {
    return c.json({
      tools: Object.values(MCP_TOOLS),
      version: '1.0.0',
      server: 'AlgoFin.ai MCP Server',
    });
  } catch (error) {
    console.error('Error listing MCP tools:', error);
    return c.json({ error: 'Failed to list tools' }, 500);
  }
});

// Execute MCP tool
app.post('/make-server-f118884a/mcp/execute', async (c) => {
  try {
    const { error, userId } = await verifyUser(c.req.header('Authorization'));
    if (error) return c.json({ error }, 401);
    
    const { tool, args } = await c.req.json();
    
    console.log(`🤖 MCP: Executing tool "${tool}" for user ${userId}`);
    
    // Add userId to args if not present
    const toolArgs = { ...args, userId };
    
    const result = await handleMCPTool(tool, toolArgs);
    
    return c.json({
      success: true,
      tool,
      result,
      executedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error executing MCP tool:', error);
    return c.json({ 
      success: false,
      error: error.message || 'Failed to execute tool',
    }, 500);
  }
});

// MCP Server info endpoint
app.get('/make-server-f118884a/mcp/info', async (c) => {
  return c.json({
    name: 'AlgoFin.ai MCP Server',
    version: '1.0.0',
    description: 'AI-powered trading platform with multi-broker support, strategy management, and performance analytics',
    capabilities: [
      'Portfolio management across multiple brokers',
      'Trade execution through Alpaca and Interactive Brokers',
      'Strategy creation and management',
      'Performance analytics and backtesting',
      'TradingView webhook integration',
      'Real-time trade synchronization',
      'Risk management and position sizing',
    ],
    endpoints: {
      tools: '/make-server-f118884a/mcp/tools',
      execute: '/make-server-f118884a/mcp/execute',
      info: '/make-server-f118884a/mcp/info',
    },
  });
});

Deno.serve(app.fetch);
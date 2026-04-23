// Improved sync trades logic
// This is a reference implementation - needs to be integrated into index.tsx

export async function syncStrategyTrades(userId: string, strategyId: string, brokerData: any, kv: any) {
  // Get all trades for this strategy
  const allTrades = await kv.getByPrefix(`user:${userId}:trade:`);
  const strategyTrades = allTrades.filter((trade: any) => trade.strategyId === strategyId);
  
  console.log(`Syncing ${strategyTrades.length} trades for strategy ${strategyId}`);
  
  let updatedCount = 0;
  let deletedCount = 0;
  
  // First, fetch all recent orders from Alpaca (last 7 days)
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
    console.error('Error fetching orders from Alpaca:', fetchError);
  }
  
  return { updatedCount, deletedCount };
}

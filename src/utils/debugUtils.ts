// Debug utilities for AlgoFin.ai
// These functions are exposed to the browser console for debugging

import { projectId } from './supabase/info';

export async function checkBrokers() {
  const token = localStorage.getItem('access_token');
  if (!token) {
    console.error('❌ Not logged in. Please log in first.');
    return;
  }

  try {
    console.log('🔍 Checking brokers...');
    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/debug/brokers`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      console.error('❌ Failed to fetch brokers:', response.status, await response.text());
      return;
    }

    const data = await response.json();
    console.log('✅ Broker Debug Info:');
    console.log(`   User ID: ${data.userId}`);
    console.log(`   Total Brokers: ${data.totalBrokers}`);
    console.log('\n📊 Broker Details:');
    data.brokers.forEach((broker: any, index: number) => {
      console.log(`\n${index + 1}. ${broker.name} (${broker.id})`);
      console.log(`   Type: ${broker.brokerType}`);
      console.log(`   Connected: ${broker.connected}`);
      console.log(`   Account ID: ${broker.accountId}`);
      console.log(`   Has API Key: ${broker.hasApiKey} ${broker.hasApiKey ? `(${broker.apiKeyPreview})` : ''}`);
      console.log(`   Has API Secret: ${broker.hasApiSecret}`);
    });

    return data;
  } catch (error) {
    console.error('❌ Error checking brokers:', error);
  }
}

export async function checkWebhooks() {
  const token = localStorage.getItem('access_token');
  if (!token) {
    console.error('❌ Not logged in. Please log in first.');
    return;
  }

  try {
    console.log('🔍 Checking webhooks...');
    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/webhooks`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      console.error('❌ Failed to fetch webhooks:', response.status, await response.text());
      return;
    }

    const data = await response.json();
    console.log('✅ Webhook Debug Info:');
    console.log(`   Total Webhooks: ${data.length}`);
    console.log('\n📊 Webhook Details:');
    data.forEach((webhook: any, index: number) => {
      console.log(`\n${index + 1}. ${webhook.name} (${webhook.id})`);
      console.log(`   Status: ${webhook.status}`);
      console.log(`   Strategy: ${webhook.strategy}`);
      console.log(`   Strategy ID: ${webhook.strategyId || 'none'}`);
      console.log(`   Broker ID: ${webhook.brokerId || 'none (will use first available)'}`);
      console.log(`   URL: ${webhook.url}`);
      console.log(`   Triggers: ${webhook.triggers || 0}`);
    });

    return data;
  } catch (error) {
    console.error('❌ Error checking webhooks:', error);
  }
}

export async function testAlpacaConnection() {
  const token = localStorage.getItem('access_token');
  if (!token) {
    console.error('❌ Not logged in. Please log in first.');
    return;
  }

  try {
    console.log('🧪 Testing Alpaca connection with a dummy order...');
    console.log('   This will attempt to place a 1-share AAPL market order');
    console.log('   (Paper trading - no real money)');
    
    const response = await fetch(
      `https://${projectId}.supabase.co/functions/v1/make-server-f118884a/debug/test-alpaca`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Test failed:', response.status, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        console.error('Error details:', errorJson);
      } catch (e) {
        // Not JSON
      }
      return;
    }

    const data = await response.json();
    console.log('\n✅ Test Results:');
    console.log(`   Broker: ${data.broker.name} (${data.broker.accountId})`);
    console.log(`\n   Order Sent:`, data.testOrder);
    console.log(`\n   Alpaca Response:`);
    console.log(`   Status: ${data.response.status}`);
    console.log(`   Success: ${data.response.ok}`);
    
    if (data.response.ok) {
      console.log(`   ✅ ORDER SUCCESSFUL!`);
      console.log(`   Order ID: ${data.response.data.id}`);
      console.log(`   Status: ${data.response.data.status}`);
    } else {
      console.error(`   ❌ ORDER FAILED!`);
      console.error(`   Error:`, data.response.data);
      
      if (data.response.data.message) {
        console.error(`\n   📋 Error Message: ${data.response.data.message}`);
      }
      if (data.response.data.code) {
        console.error(`   📋 Error Code: ${data.response.data.code}`);
      }
    }
    
    console.log('\n   Full response:', data);
    
    return data;
  } catch (error) {
    console.error('❌ Error testing Alpaca connection:', error);
  }
}

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as any).debugAlgoFin = {
    checkBrokers,
    checkWebhooks,
    testAlpacaConnection,
  };
  
  console.log('🔧 Debug utilities loaded! Use:');
  console.log('   debugAlgoFin.checkBrokers() - Check broker connections');
  console.log('   debugAlgoFin.checkWebhooks() - Check webhook configurations');
  console.log('   debugAlgoFin.testAlpacaConnection() - Test Alpaca API with dummy order');
}

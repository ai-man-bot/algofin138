import { useState } from 'react';
import { testWebhook as testWebhookAPI } from '../utils/api';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { buildFunctionUrl } from '../utils/supabaseUrls';

export function WebhookDebugPage() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [dbResult, setDbResult] = useState<any>(null);

  const checkDatabase = async () => {
    try {
      setLoading(true);
      setDbResult(null);
      
      const apiUrl = buildFunctionUrl('/test-all-events');
      
      console.log('🔍 Checking database for stored events...');
      console.log('API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${publicAnonKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      
      console.log('Database check result:', data);
      setDbResult(data);
    } catch (error) {
      console.error('Database check error:', error);
      setDbResult({ error: String(error) });
    } finally {
      setLoading(false);
    }
  };

  const testHealthEndpoint = async () => {
    try {
      setLoading(true);
      const healthUrl = buildFunctionUrl('/health');
      
      console.log('Testing health endpoint WITHOUT auth:', healthUrl);
      
      const response = await fetch(healthUrl);
      const data = await response.json();
      
      console.log('Health check result:', { status: response.status, data });
      
      alert(`Health check: ${response.status} - ${JSON.stringify(data)}`);
    } catch (error) {
      console.error('Health check error:', error);
      alert(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const testWebhook = async () => {
    setLoading(true);
    setResult(null);

    try {
      const testPayload = {
        action: 'buy',
        symbol: 'AAPL',
        quantity: 100,
        price: 150.25,
        timestamp: new Date().toISOString(),
      };

      console.log('Sending test webhook via proxy to:', webhookUrl);
      console.log('Payload:', testPayload);

      // Use the backend proxy to avoid CORS issues
      const data = await testWebhookAPI(webhookUrl, testPayload);

      console.log('Response data:', data);

      setResult(data);
    } catch (error) {
      console.error('Error testing webhook:', error);
      setResult({
        error: true,
        message: error instanceof Error ? error.message : String(error),
        type: 'Request Error',
      });
    } finally {
      setLoading(false);
    }
  };

  const testWebhookDirectly = async () => {
    setLoading(true);
    setResult(null);

    try {
      const testPayload = {
        action: 'buy',
        symbol: 'AAPL',
        quantity: 100,
        price: 150.25,
        timestamp: new Date().toISOString(),
      };

      console.log('🚀 DIRECT TEST - Calling webhook-receiver directly from browser');
      console.log('Webhook URL:', webhookUrl);
      console.log('Payload:', testPayload);

      // Call webhook-receiver DIRECTLY from the browser (not through proxy)
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
      });

      const responseText = await response.text();
      console.log('Direct response status:', response.status);
      console.log('Direct response body:', responseText);

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { rawResponse: responseText };
      }

      setResult({
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData,
      });
    } catch (error) {
      console.error('Error testing webhook directly:', error);
      setResult({
        error: true,
        message: error instanceof Error ? error.message : String(error),
        type: 'Direct Request Error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-4xl px-6 py-8">
      <h2 className="mb-4 text-slate-100">Webhook Debug Tool</h2>
      <p className="mb-8 text-slate-400">
        Test your webhook URLs to diagnose connectivity and authentication issues
      </p>

      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm text-slate-300">Webhook URL</label>
          <input
            type="text"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-blue-500"
            placeholder={`https://${projectId}.supabase.co/functions/v1/make-server-f118884a/webhook-receiver?token=YOUR-TOKEN`}
          />
        </div>

        <button
          onClick={testWebhook}
          disabled={!webhookUrl || loading}
          className="rounded-lg bg-blue-500 px-6 py-3 transition-colors hover:bg-blue-600 disabled:bg-slate-700 disabled:cursor-not-allowed"
        >
          {loading ? 'Testing...' : 'Test Webhook'}
        </button>

        <button
          onClick={testWebhookDirectly}
          disabled={!webhookUrl || loading}
          className="ml-4 rounded-lg bg-purple-500 px-6 py-3 transition-colors hover:bg-purple-600 disabled:bg-slate-700 disabled:cursor-not-allowed"
        >
          {loading ? 'Testing...' : 'Test DIRECTLY (Browser)'}
        </button>

        <button
          onClick={testHealthEndpoint}
          disabled={loading}
          className="ml-4 rounded-lg bg-emerald-500 px-6 py-3 transition-colors hover:bg-emerald-600 disabled:bg-slate-700 disabled:cursor-not-allowed"
        >
          Test Health Endpoint (No Auth)
        </button>

        <button
          onClick={checkDatabase}
          disabled={loading}
          className="ml-4 rounded-lg bg-indigo-500 px-6 py-3 transition-colors hover:bg-indigo-600 disabled:bg-slate-700 disabled:cursor-not-allowed"
        >
          Check Database for Stored Events
        </button>

        {result && (
          <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
            <h3 className="mb-4 text-slate-100">Test Result</h3>
            
            {result.error ? (
              <div className="space-y-2">
                <div className="rounded-lg bg-rose-500/10 p-4 text-rose-400">
                  <p className="font-bold">{result.type}</p>
                  <p className="mt-2 text-sm">{result.message}</p>
                  
                  {result.type === 'Network/CORS Error' && (
                    <div className="mt-4 rounded bg-rose-500/20 p-3 text-sm">
                      <p className="font-bold">Possible Solutions:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>Ensure the webhook-receiver function has CORS enabled</li>
                        <li>Check that verify_jwt is set to false in config.toml</li>
                        <li>Verify the URL is correct and accessible</li>
                        <li>Try the webhook from an external tool like Postman or curl</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className={`rounded-lg p-4 ${result.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                  <p className="font-bold">
                    Status: {result.status} {result.statusText}
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-sm text-slate-400">Response Headers:</p>
                  <pre className="rounded-lg bg-slate-800/50 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
                    {JSON.stringify(result.headers, null, 2)}
                  </pre>
                </div>

                <div>
                  <p className="mb-2 text-sm text-slate-400">Response Data:</p>
                  <pre className="rounded-lg bg-slate-800/50 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
                    {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {dbResult && (
          <div className="mt-6 rounded-xl border border-slate-700/50 bg-slate-900/30 p-6">
            <h3 className="mb-4 text-slate-100">Database Check Result</h3>
            
            {dbResult.error ? (
              <div className="space-y-2">
                <div className="rounded-lg bg-rose-500/10 p-4 text-rose-400">
                  <p className="font-bold">Error</p>
                  <p className="mt-2 text-sm">{dbResult.error}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg p-4 bg-emerald-500/10 text-emerald-400">
                  <p className="font-bold">
                    Events found: {dbResult.eventsCount || 0}
                  </p>
                  <p className="text-sm mt-1">
                    Webhook tokens: {dbResult.webhookTokensCount || 0}
                  </p>
                </div>

                {dbResult.events && dbResult.events.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm text-slate-400">Stored Events:</p>
                    <pre className="rounded-lg bg-slate-800/50 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
                      {JSON.stringify(dbResult.events, null, 2)}
                    </pre>
                  </div>
                )}

                {dbResult.webhookTokens && dbResult.webhookTokens.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm text-slate-400">Webhook Tokens:</p>
                    <pre className="rounded-lg bg-slate-800/50 p-4 font-mono text-xs text-slate-300 overflow-x-auto">
                      {JSON.stringify(dbResult.webhookTokens, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-300">
          <p className="font-bold mb-2">📋 Testing with curl:</p>
          <pre className="font-mono text-xs bg-slate-900/50 p-3 rounded overflow-x-auto">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"buy","symbol":"AAPL","quantity":100}'`}
          </pre>
        </div>
      </div>
    </div>
  );
}

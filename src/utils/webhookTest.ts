/** Deliver the supplied body unchanged. A timeout must not trigger an automatic retry. */
export async function sendWebhookTest(url: string, payload: string, contentType: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType },
      body: payload, signal: controller.signal, redirect: 'error', credentials: 'omit' });
    const raw = await response.text();
    let body: unknown = raw;
    try { body = JSON.parse(raw); } catch { /* Preserve non-JSON errors. */ }
    return { status: response.status, ok: response.ok, body };
  } catch {
    throw new Error('No response received. Delivery may have occurred. Check Recent events and Alpaca before retrying; reuse the same event_id.');
  } finally { clearTimeout(timeout); }
}

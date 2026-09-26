import React from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsOrderTicket } from '../src/components/OptionsOrderTicket';
import { normalizeOptionTicket } from '../src/utils/optionTicket';
import '../src/index.css';

// Isolated component harness. All remote requests are intercepted; no broker credentials or orders.
const plans: any[] = [];
const calls: any[] = [];
(window as any).ticketTest = { calls, plans, failResponseOnce: false, failContracts: false };
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href);
  if (!url.hostname.endsWith('.supabase.co')) throw new Error('Unexpected fixture request');
  const path = url.pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ path, method: init?.method || 'GET', body });
  if (path.endsWith('/brokers')) return Response.json([{ id: 'paper-test', name: 'Verification account', connected: true, broker_type: 'alpaca', base_url: 'https://paper-api.alpaca.markets' }]);
  if (path.endsWith('/option-plans/preview')) return Response.json({ instruction: normalizeOptionTicket(body), broker_id: body.broker_id, environment: body.environment, contract_size: 100 });
  if (path.endsWith('/option-plans')) {
    if (init?.method === 'POST') {
      const existing = plans.find(plan => plan.request_id === body.request_id);
      const plan = existing || { ...normalizeOptionTicket(body), id: crypto.randomUUID(), request_id: body.request_id,
        broker_account_id: body.broker_id, broker_base_url: 'https://paper-api.alpaca.markets', status: 'queued',
        entry_filled_qty: 0, target_filled_qty: 0, created_at: new Date().toISOString() };
      if (!existing) plans.push(plan);
      if ((window as any).ticketTest.failResponseOnce) { (window as any).ticketTest.failResponseOnce = false; throw new Error('Simulated response lost'); }
      return Response.json({ plan, duplicate: Boolean(existing) }, { status: 202 });
    }
    return Response.json({ plans });
  }
  if (path.endsWith('/alpaca/options/contracts')) {
    if ((window as any).ticketTest.failContracts) return Response.json({ error: 'Simulated contract service failure' }, { status: 502 });
    return Response.json({ option_contracts: [{ symbol: 'PLTR271016C00150000', underlying_symbol: 'PLTR', expiration_date: '2027-10-16', strike_price: '150', type: 'call', status: 'active', tradable: true }] });
  }
  if (path.includes('/alpaca/options/chain/')) return Response.json({ snapshots: {} });
  throw new Error(`Unhandled fixture request ${path}`);
};
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-slate-900 p-6"><p className="mb-4 text-sm text-amber-300">Browser verification · simulated API only · no orders</p><OptionsOrderTicket /></main>);

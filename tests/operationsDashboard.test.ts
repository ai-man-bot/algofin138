import assert from 'node:assert/strict';
import {
  buildDefaultAutomationPreview,
  buildOperationsReadinessReport,
  buildSampleOmsOrders,
  buildSampleRiskAudits,
  getOperationsPanel,
  operationsPanels,
} from '../src/utils/operationsDashboard.ts';

assert.deepEqual(
  operationsPanels.map((panel) => panel.id),
  ['risk', 'oms', 'options', 'automation', 'readiness'],
);

assert.equal(getOperationsPanel('options').title, 'Options Order Review');

const audits = buildSampleRiskAudits();
assert.equal(audits.length, 3);
assert.ok(audits.some((audit) => audit.status === 'block'));

const orders = buildSampleOmsOrders();
assert.ok(orders.some((order) => order.status === 'partially_filled'));

const automation = buildDefaultAutomationPreview();
assert.equal(automation.enabled, true);
assert.equal(automation.allowedSymbols.includes('AAPL'), true);

const blockedReadiness = buildOperationsReadinessReport();
assert.equal(blockedReadiness.status, 'blocked');
assert.ok(blockedReadiness.blockers.some((blocker) => blocker.includes('ALPACA_API_KEY')));

const readyReadiness = buildOperationsReadinessReport({
  presentEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALPACA_API_KEY'],
  availableRoutes: [
    '/platform-orders/route',
    '/platform-orders/:id/reconcile',
    '/strategy-automation/schedules',
    '/strategy-automation/run',
  ],
});
assert.equal(readyReadiness.status, 'ready');

console.log('operations dashboard tests passed');

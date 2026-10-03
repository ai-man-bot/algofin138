# Option signal implementation

Implemented and deployed on October 2, 2026. Migration 202610020001 is applied to
production; webhook-listener version 46 was deployed and confirmed ACTIVE.
The frontend status/preview release is live. Deployment checks placed no broker
orders and did not replay historical alerts.

## Supported behavior

- Option entries accept joined BTOBuy, flexible whitespace/case, optional "the",
  decimal strikes, and M/D, M/D/YY, or M/D/YYYY dates. Explicit expired dates fail.
- Full-close, stop-hit, and trailing-stop-hit messages queue a market close for
  all remaining managed contracts after cancellation and fill reconciliation.
- Option target messages sell one contract per new higher target milestone,
  retaining one runner. A filled automatic first target credits the first alert.
  Identical/lower target prices do not cause another sale. Explicit target numbers
  are also parsed; profit percentages remain informational.
- Raised stop prices become broker-side GTC stop orders covering the remaining
  contracts. Stops only increase. Existing limit targets and protective stops are
  canceled and confirmed before the new sale/stop. No overlapping target order is
  recreated once signal management begins.
- Stock alerts, DCA alerts, and bare STC are recognized and displayed as needing
  configuration/review. Stock and DCA orders remain disabled pending sizing rules.
- Preview is read-only and shows the action, matched plan, execution policy, and
  cancellation requirements. Final sizing is computed from reconciled broker
  fills and positions, not the alert price or the original three-contract quantity.
- Recent events exposes action processing/errors and fills. Operations shows
  other exit fills, raised stop price, and remaining managed quantity.

## Matching, retries, and recovery

Only positions created by the existing option plan workflow are managed. Match
owner, route, broker account, underlying, strike, C/P, and expiration. Missing exit
years are resolved against an unexpired matching plan; multiple matches require
review. Broker environment changes, shared contracts across plans, unmanaged orders,
or position/fill discrepancies require review before trading.

New action records and both workers share the plan lease. Account/contract leases
also prevent concurrent processing across different plans. Submission intent and
permanent client order IDs are persisted before POST; uncertain responses are
looked up instead of submitted again. Cancellation is confirmed by reading the
order's terminal state, including any racing fills. Provider event IDs cannot be
reused between entry and management actions. Without an event ID, identical
normalized actions deduplicate for the matched plan's lifecycle.

Action errors and uncertain orders appear in Recent events and plan last_error.
Needs-attention actions block further management until an operator reconciles
broker orders, positions, and stored fills. Do not clear attempted timestamps or
reuse a failed action's client ID to submit different instructions. A broker stop
rejection is not replaced with an undisclosed software stop. Stops can be briefly
absent while a cancel/new-order sequence is pending; polling is not tick-level.

The worker caps action/candidate histories at 200 and requires review beyond that
bound. Terminal journaled fills are cached; active orders continue to reconcile.
Historical rejected alerts are test fixtures, not automatically replayed orders.

## Verification performed

- `npm run test:webhook-signals`: parser, observed message families, dates,
  preview-only/account isolation, original entry lifecycle, and management worker.
  Covers duplicate/out-of-order targets, first-target credit, one runner, stop
  raises, partial entries, cancel/fill races, broker-position drift, unrelated
  orders, lost POST responses, and crash recovery of monotonic stop policy.
- `node tests/optionSignalDatabase.test.mjs`: isolated PostgreSQL via temporary
  PGlite; applies both migrations and verifies action deduplication/conflicts,
  cross-table event IDs, account/contract leases, wakeups, and execution grants.
  No production database is used. To reproduce, install PGlite under
  `tmp/webhook-db-verification` using the command in the test file.
- `npx --yes deno check --node-modules-dir=none supabase/functions/webhook-listener/index.ts`:
  complete backend type check passes.
- Production frontend build passes.
- The existing full `npm test` command is blocked by tests/apiCache.test.ts importing
  a missing testWebhook export from src/utils/api.ts. This mismatch predates these
  changes and does not occur in the focused suite.

## Activation and paper verification

1. Apply migration `202610020001_option_signal_actions.sql` before deploying the
   new backend. It changes worker claims/statuses and adds owner-readable,
   service-role-writable action records. No historical alert is inserted.
2. Deploy webhook-listener and the frontend from only this release's changes;
   preserve existing route tokens, broker connections, and worker secrets/cron.
3. On a dedicated paper account/route with no other orders for the contract,
   verify an eligible three-contract entry and the existing one-contract target.
   After that target fills, send one fresh target alert: there must be no duplicate
   profit sale and one stop protecting two contracts. Send a higher target: verify
   one sale and a raised stop for one runner. Repeat the same event ID and then a
   lower target: neither may sell more or reduce the stop.
4. Send a fresh full-close alert. Confirm cancellation of the runner stop, exactly
   one market sell of the remaining managed quantity, final broker fills, and a
   closed plan. Check both stored action status and the actual Alpaca order.
5. Independently verify a close while the first target is outstanding, a partially
   filled entry, broker stop acceptance, and stop-triggered fills. Inspect cron
   and action errors. Only then enable the corresponding live-route behavior.

Native option stop support was checked against
[Alpaca Options Trading](https://docs.alpaca.markets/us/docs/options-trading).
Production verification confirmed migration history, RLS, service-role-only
action mutations, worker readiness, active cron, and worker HTTP 200 responses.
A no-order stock probe returned Needs configuration, and an exit for a fictional
unheld contract returned No matching unexpired managed trade without creating a
plan/action. Real paper end-to-end broker acceptance and fills remain unverified.

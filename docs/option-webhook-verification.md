# Deployment and verification

Supabase project: `dzboqhobrmzglyuofcyk`.
Deployed function: `webhook-listener`, version **37**, ACTIVE (GitHub deployment).

Completed:

- Both option migrations applied through the CLI migration system.
- Broker ID column corrected to text to match the actual database.
- Vault/Edge worker secret configured without printing or committing its value.
- Scheduler active every minute, with authenticated HTTP 200 responses after deployment.
- Transactional SQL verification passed for unique delivery IDs, claim leases,
  expired-lease recovery, service-only mutation/claim access, and owner-only reads.
  All SQL test mutations rolled back.
- Full Edge Function Deno type check passes. Existing signal order-type and
  time-in-force issues were corrected using explicit validation.
- All `npm test` suites pass.
- Paper account read and option contract lookup pass; account options level is 3.
- Deployed raw-text and JSON messages return 202 and a plan ID.
- Equivalent text/JSON delivery deduplicates; reusing an event ID with different
  instructions returns 409; malformed and conflicting instructions return 400.
- Unauthenticated internal-worker access returns 401.
- Stock JSON with an informational message reaches existing limit-price validation.
- Impossible option contracts reach `entry_terminal` with the Alpaca lookup error;
  `entry_attempted_at` and broker order ID remain null. No broker orders submitted.
- The temporary verification root route was deactivated; diagnostic plans remain
  in the table as an audit trail.

Ingress verification plan IDs:

- `9e5693fa-f52f-4e01-96ce-7bde1456652c`
- `a510daa3-a082-4b4a-bd61-beaa9f9accbd`

Scheduled recovery probe: `78a1d8e7-0b03-4775-90c2-ee9c692b40b4`.
This impossible-contract plan was inserted with an expired lease and no direct
worker invocation, to check that cron independently picks it up.
Result: **passed**. Cron recovered the lease and recorded `entry_terminal` with
the expected contract-not-found error. No submission was attempted, the lease was
released, and the two latest scheduled HTTP responses were 200 without timeouts.

## Options ticket release verification (2026-09-26)

- Authenticated preview, submission, and account-filtered plan history are implemented.
- Operations accepts the original option message or a selected real chain contract.
  The review shows the resolved expiration year, paper/live account, 3-contract DAY
  entry, and 1-contract GTC target. It uses the same durable worker as webhooks.
- Stable request IDs survive uncertain responses and page reloads within a browser
  session. Browser testing confirmed retrying a lost response created one plan.
- Browser checks covered message review, chain selection, mobile layout, and no
  uncaught errors using a mock broker fixture; they did not place broker orders.
- The Webhooks refresh callbacks now reference the existing screen loader, fixing
  the undefined callback that caused a blank screen.
- Unit tests, production build, and full backend Deno type check passed. A standalone
  frontend TypeScript check still has existing missing React type declarations.
- Version 36 deployed successfully. Raw-text/JSON ingress, duplicate/conflict checks,
  malformed inputs, and the stock validation path passed against the deployed API.
  Diagnostic plans: `d744da60-d9f1-4c94-a790-35b0a59e76e4` and
  `dcec0f50-4533-4036-aa92-454190ac6835` (impossible contracts, no orders).
- Feature commit `416033e` published to production at https://algofin138.vercel.app.
  Vercel reached READY; the corrected Supabase GitHub deployment workflow passed.
  Backend version 37 is active; cron remains enabled and returns HTTP 200.
- Signed-in production checks passed for message preview, real Alpaca contract-chain
  loading/selection, and account-filtered plan history. Both input paths previewed
  `PLTR261016P00190000`, expiration 2026-10-16, 3 DAY contracts at 6.65 and one GTC
  target at 7.65. The Submit button was never activated.
- Webhooks no longer crashes. Follow-up implementation restores owner-scoped route
  listing, creation, editing, deactivation, and event history. New routes require an
  explicit connected Alpaca account and paper/live environment confirmation.
  Existing strategy associations and tokens are preserved during edits.
- The former Test action is a read-only message preview: raw option text and JSON
  are validated without storing a plan or submitting any broker order. Errors are
  visible. Accepted/queued entries are not reported as fills.
- Management tests cover cross-user isolation, account/environment mismatch,
  preview-only behavior, deactivation without canceling existing plans, sanitized
  event output, and database error propagation. Full tests and Deno checks passed.

## Remaining user-led paper verification

The paper market was closed during deployment verification. Per the user's
instruction, no follow-up has been scheduled. No valid paper or live order was
submitted during this phase.

At a later market-open session, select an actual tradable contract, submit a paper
entry, observe the 3-contract DAY limit acceptance/fills and the 1-contract GTC
target acceptance/fill, and confirm the final 2-contract remainder. Actual broker
partial fills, target rejection/cancellation, and timeout recovery still need
end-to-end validation; unit tests cover those state transitions with mock responses.

Use a legacy strategy webhook with the current paper connection, or a root route
explicitly linked to that connection. Inspection found older root routes referencing
a removed broker ID; these routes must be re-linked before trading through them.
The implementation intentionally does not silently substitute another account.

Reusable checks:

- `npm test`
- `npx --yes deno check --node-modules-dir=none --no-lock supabase/functions/webhook-listener/index.ts`
- `npx supabase@latest db query --linked --file tests/optionDatabaseVerification.sql -o json`
- `powershell -NoProfile -File tests/verifyOptionDeployment.ps1`

The PowerShell verification uses an impossible contract and does not test actual fills.
See [option-webhooks.md](option-webhooks.md) for the supported message and operating rules.

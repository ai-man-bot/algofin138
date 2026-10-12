# Paper verification and release runbook

Last updated: 2026-10-11

This runbook operationalizes the phased release sequence. Nothing below places
live orders. Paper verification must pass before any live-route behavior is
enabled.

## Release flow (all changes ship together)

1. Work happens on feature branches merged into `staging`. Production
   (`main`) is only updated by a reviewed merge; the Supabase deploy workflow
   (migrations + edge function) triggers exclusively on `main` pushes.
2. CI on `staging` and PRs runs: frontend build, all platform test suites,
   PGlite database verification, and `deno check` on the edge function. The
   same checks run inside the deploy workflow before anything touches the
   live project.
3. Tag the release before merging: `git tag release/<date> && git push --tags`.
   Rollback for the function is redeploying from that tag; frontend rollback is
   the previous Vercel deployment. Migrations must stay additive (nullable
   columns, new tables, no drops/renames) so the pre-deploy window where old
   function code runs against the new schema is safe.
4. After the deploy completes, run the post-deploy smoke checks below.

## Post-deploy smoke checks (read-only, run on every release)

1. `tests/verifyOptionDeployment.ps1` — migration history, RLS, worker
   readiness, cron activity.
2. Send a **preview-only** option message through a connected route
   (`POST /webhooks/<id>/preview` from the Webhooks page) and confirm the
   resolved contract and entry/first-target payloads. Preview never orders.
3. Webhooks page → Recent events: confirm the request was logged and no
   errors appear.
4. Supabase dashboard → Edge Function logs: no startup or route errors.
5. Confirm the `option-first-target-reconciliation` cron job is active and
   its HTTP invocations return 200 (pg_cron + pg_net logs).

## Paper verification of the option pipeline

Required before enabling any live route behavior, and before relying on any
new execution path (route auto-execute, automation runs). Use a dedicated
paper account/route with no other orders on the test contract. Do not replay
historical alerts.

1. **Entry and first target.** Send a current, tradable three-contract entry
   message. Verify exactly one 3-contract DAY limit entry was accepted by
   Alpaca, and after at least one entry fill, one 1-contract GTC first-target
   limit exists. Re-send the same `event_id`: no new orders may be created.
2. **Milestones and stops.** After the first target fills, send one fresh
   target alert: no duplicate profit sale, one stop protecting two contracts.
   Send a higher target: exactly one sale and a raised stop for the runner.
   Repeat the same event ID and then a lower target: neither may sell more or
   lower the stop.
3. **Full close.** Send a fresh full-close alert. Confirm cancellation of the
   runner stop, exactly one market sell of the remaining managed quantity,
   final broker fills, and a closed plan. Check both the stored action status
   and the actual Alpaca order.
4. **Edge cases.** Independently verify a close while the first target is
   outstanding, a partially filled entry, broker stop acceptance, and a
   stop-triggered fill. Inspect cron logs and action errors.
5. **Route auto-execute (new).** On a paper route with `auto_execute`
   enabled, deliver a structured equity signal that passes the risk gate.
   Confirm: one OMS order row, one `submission_attempted` and one `submitted`
   `oms_executions` row, and exactly one Alpaca order whose client order id is
   `oms-<oms order id>`. Re-deliver the same payload: the risk engine may
   block it as a duplicate (expected); there must never be an unjournaled
   resubmission.
6. **Automation run (new).** Save a schedule, then POST
   `/strategy-automation/run` with `auto_execute: true` and one test signal
   on the paper account. Confirm the run record, OMS order, audit record,
   and the broker order. Then run again inside the interval: the run must be
   recorded as `not_due` with no new orders.

Only after all of the above passes on paper should the corresponding
live-route behavior be enabled, one route at a time.

## References

- `docs/option-webhooks.md` — message grammar, endpoints, activation.
- `docs/option-signal-release.md` — management actions and verification notes.
- `docs/option-webhook-verification.md` — deployment verification history.
- `ADR-001` — Python strategy runner signal contract used by the automation run endpoint.

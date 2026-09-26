# Option webhook entry and first target

Supported message:

```text
PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65
```

Send `text/plain` to an existing tokenized webhook URL, or a JSON object:

```json
{
  "route_token": "YOUR_EXISTING_ROUTE_TOKEN",
  "event_id": "provider-stable-message-id",
  "message": "PLTR: 150C 5/22: BTO Buy to open at 6.65 with first target above 7.65"
}
```

Both `/webhook-listener?token=...` and
`/webhook-listener/tradingview-webhook/STRATEGY_ID?token=...` are supported.
When `TRADINGVIEW_WEBHOOK_SECRET` is configured, option messages must include it
in `x-webhook-secret` or the JSON `secret` field. Existing structured stock orders
continue using their existing path. Do not combine an option message with separate
symbol/quantity/side/price order fields.

## Trading rules

- Buy to open 3 contracts with a DAY limit at the entry price.
- Resolve month/day using today's date in America/New_York. A date before today
  rolls to next year; today does not. Invalid calendar dates are rejected. A
  missing/nontradable actual contract is rejected by the worker; no alternate
  expiration or strike is silently selected.
- Once at least 1 entry contract fills, sell to close exactly 1 contract with a
  GTC limit at the first target. `above 7.65` means a 7.65 limit, not a crossing trigger.
- Entry partial fills do not trigger multiple exits. An unfilled canceled or
  expired entry has no exit. A partially filled canceled entry can still get the
  first target. The actual remainder is entry filled quantity minus target filled
  quantity; it is 2 only when all 3 entry contracts filled and the first target filled.
- GTC exits remain at Alpaca across days. Canceled, expired, replaced, or rejected
  exits are not automatically recreated. They require attention.
- Subsequent closing messages and management of remaining contracts are not implemented.

## Durable processing and duplicate handling

HTTP 202 means the plan is stored, not that Alpaca accepted or filled an order.
Inspect `public.option_trade_plans` for entry/target broker IDs, statuses, filled
quantities, and `last_error`. Authenticated users may read only their own plans;
only the service role may mutate them. Existing webhook request logs contain the
plan ID and ingress result. The existing dashboard trade history is not a view of
this new table.

A stable JSON `event_id` or `x-webhook-id` header deduplicates deliveries within
the route. Reusing an ID with different instructions returns 409. Without an ID,
identical normalized contract/entry/target signals on the same New York date are
treated as one delivery. Supply distinct event IDs for intentional repeated entries.
Raw-text retries across dates cannot be reliably identified; send a stable ID for
delivery systems that retry overnight.

The worker commits an attempted timestamp before each POST and uses permanent
client order IDs. On uncertainty it looks up that same ID without repeating POST.
If the order is still absent after five minutes, the plan becomes `needs_attention`.
This includes interruption between saving intent and POST: inspect the broker
before any operator recovery. Do not clear attempted timestamps blindly.

Database leases prevent concurrent processing. Three due plans are claimed per
invocation, with a three-minute lease. The scheduled worker runs every minute;
target placement normally follows the next poll and can take longer under load
or broker failures. This is not tick-level target execution. Once submitted, the
GTC limit is managed by Alpaca. Connection IDs and paper/live base URLs are pinned
to each plan. A changed/disconnected broker produces an error rather than silently
moving the plan to another account. Existing kill-switch/authorized-user settings
are checked before new entries; exits continue to reconcile. Other portfolio sizing
rules from Strategy Lab are not applied to this fixed-quantity option flow.

## Activation

The Operations options ticket also accepts this message format. Select an Alpaca
account, paste the message (or select a fetched contract and enter both prices),
review the resolved contract and account, then submit. Review does not place an
order. Submission creates a durable plan; acceptance and fills appear in the
account's Option plans list. An uncertain response offers retry with the same
request ID. Do not create a separate ticket to retry an uncertain submission.

Authenticated endpoints are `POST /option-plans/preview`, `POST /option-plans`,
and `GET /option-plans?brokerId=...` beneath the existing webhook-listener base.
Submission requires `broker_id`, `environment`, a stable UUID `request_id`, and
either `message` or `symbol`, `entry_price`, and `target_price`. Quantities and
time-in-force are fixed by the agreed workflow. Webhook ingress remains available
without using the frontend, authenticated by its existing route token.

1. Apply migrations `202609250001_option_trade_plans.sql` and
   `202609250002_option_reconciliation_schedule.sql` in the target Supabase project.
   The project needs Supabase Vault, pg_cron, and pg_net. The existing broker and
   webhook tables must already exist.
2. Generate a strong shared secret and set the Edge Function secret
   `OPTION_WORKER_SECRET`. Store the same value in Vault as `option_worker_secret`.
3. Store the exact URL
   `https://PROJECT_REF.supabase.co/functions/v1/webhook-listener/internal/options/reconcile`
   in Vault as `option_worker_url`. It must match `SUPABASE_URL` plus that path.
   Use the project's secret-management UI; never commit secret values.
4. Deploy the updated `webhook-listener` function, keeping its existing
   `verify_jwt = false` configuration. The internal worker authenticates with
   `x-option-worker-secret`; webhook ingress authenticates the existing route token.
5. Verify the cron job `option-first-target-reconciliation` is active and its HTTP
   invocations return 200. Check cron execution and pg_net response logs. The
   ingress readiness check rejects option plans with 503 if the schedule/Vault
   values do not match the function configuration. It cannot detect future cron
   outages or network failures.
6. In a paper-connected route, send a current tradable contract message and confirm
   exactly one 3-contract DAY entry and, after a fill, one 1-contract GTC exit.
   Replay the same event ID and verify no new orders. Validate actual Alpaca account
   options eligibility and broker rejections before using a live connection.

No migration, deployment, or broker order is performed by the unit tests.
Run `npm test` for parser, duplicate identity, and mocked order-lifecycle coverage.

References: [Alpaca options API](https://docs.alpaca.markets/us/docs/options-trading)
and [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions).

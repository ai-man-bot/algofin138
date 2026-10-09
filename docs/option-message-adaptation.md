# Plan to process the observed webhook messages

Reviewed production rejected-message logs on October 1, 2026. There were 58
rejected requests: 53 format errors and five duplicate/conflicting-instruction
errors. Some older records are diagnostic inputs; these counts are not all live
trading alerts. The option parser, durable close/target handling, and raised stops
are now implemented locally. See [release verification and activation](option-signal-release.md).

## 1. Recognize the message before deciding what to trade

Keep the received text. Normalize case, whitespace, and these observed joined
words: BTOBuy, STCClose, STCReached, and DCAAdd. Accept an optional colon after
the ticker, decimal strikes, optional "the" before "first target", and dates in
M/D, M/D/YY, or M/D/YYYY format. Validate calendar dates and prices.

Split the contract/ticker header from the instruction. Parse each instruction
with its own complete template; do not loosely search for BTO or STC and guess.
An option header includes strike, C/P, and expiration. A ticker-only header is
an equity alert and must never select an option based only on its underlying.

| Observed message | Parsed meaning | Processing plan |
| --- | --- | --- |
| WULF 20C 1/15/27: BTO Buy To Open at 1.10 with first target above 1.26 | Open option; expiration January 15, 2027 | Use existing three-contract entry and one-contract first target. |
| AAPL 335C 10/2: BTOBuy To Open at 2.44 with first target above 2.81 | Same entry, joined words | Normalize and use the existing entry flow. |
| AMD: 600P 10/16: BTO BUY TO OPEN AT 5.35 WITH THE FIRST TARGET ABOVE 7.20 | Same entry, extra word | Accept the optional word; still verify the broker contract. |
| AAPL 335C 10/09: STC Close the trade at 2.40! | Close all remaining contracts | Resolve the matching position and use a separate exit worker. |
| GOOGL 360C 11/20: STC Close the trade as it hit trailing stop at 10.35! | Close all; reason is trailing stop | Same exit path. Also accept "hit stop" and joined STCClose. |
| WULF 20C 01/15: STC Reached Target 1.27 ... Raise the stops to 0.89 | Target reached; request partial profit taking and new stop | Apply configured target sizing; update protection for the remainder. |
| MSTR: STC Reached SellTarget1 @159.7. Take profits and ride the runners. Gain: 3.55% | Equity first-target alert | Parse explicit target number; apply equity sizing and account rules. |
| PURR 20C 12/18: DCAAdd more at 0.71 for dollar cost averaging. | Add to an existing option trade | Require configured add quantity and risk limits. |
| WULF: BTO Buy To Open at 14.68 with first target above 14.97 | Equity entry | Use a separate equity workflow with configured share sizing. |
| RBLX 50P 10/16: STC | Incomplete closing instruction | Recognize the action but hold for review; do not assume full close. |
| malformed | Unrecognized input | Reject with a specific explanation. |

Target messages also contain gain percentages and commentary. Store those as
metadata; they do not determine order quantity or execution price.

## 2. Match the correct trade

Match by owner, route/strategy, original broker account, asset type, and contract.
For an exit without an expiration year, match an existing managed plan's month,
day, strike, and C/P. Never apply entry's next-year rollover to an exit. If zero
or multiple trade matches exist, report "No matching trade" or "Ambiguous trade".
The first release should manage positions created by this workflow; externally
opened positions need an explicit adoption step. Shared positions across routes
must have tracked allocations before automated selling is enabled.

For new entries without a year, retain the current next-upcoming-date rule and
show the resolved date in Preview. Explicit two-digit years resolve to 2000–2099;
past/invalid expirations fail before submission.

## 3. Add execution rules for each action

These are recommended defaults to review before enabling the new actions:

- **Full close:** cancel unfilled entry/add orders and outstanding target/stop
  orders owned by the plan. Confirm cancellations or terminal fills, then re-read
  the position and close only the remaining managed quantity. A zero position is
  an already-closed event, not a new sell. Treat the reported alert price as a
  reference; choose a route policy for market versus limit execution. Recommend
  market execution for full-close alerts, especially stop-triggered alerts, subject
  to broker support and route configuration. A sell limit at the historical stop
  price might remain unfilled after the market moves below it.
- **Target reached:** recommend one contract per new target milestone for the
  existing three-contract option plan, retaining one runner. Count a fill from
  the existing automatic first-target order toward that milestone; do not sell
  another contract for the same event. Later targets can close the second contract
  once; remaining target alerts update protection only. Persist milestone and
  sold-quantity history. Reconcile pending target orders before executing any
  additional sale. Equity partial quantity requires a separate share/percentage
  rule and rounding policy.
- **Raise stops:** recommend an absolute stop price that can only increase for
  these long positions. Ignore stale lower stops. Protect only the remaining
  quantity. Coordinate protective orders with targets so they cannot both sell
  the same holdings. Implement and verify broker-supported stop behavior; a
  recorded stop value alone must not be reported as active protection.
- **DCA:** recognize and retain the alert, but keep automatic additions disabled
  until add quantity, maximum additions/exposure, and target recalculation are
  configured. Add to the matched plan rather than creating an unrelated entry.
- **Equities:** recognize ticker-only messages immediately. Enable order execution
  only after share sizing, partial-profit rules, and stop/target management are
  configured. Do not reuse option's fixed quantities for stocks.

A syntactically valid alert missing a policy or trade match should appear as
"Needs configuration" or "Needs review", with its parsed action and reason.
Do not report it as an accepted broker order or leave it silently unprocessed.

## 4. Make processing durable and avoid duplicate trades

Add a durable signal record with original text, normalized action, matched plan,
reference/target/stop prices, execution policy, resolved quantity, provider ID,
broker order IDs, and processing status. Keep entry plans and action records
separate so every STC/DCA alert is not forced into the BTO entry schema.

Serialize all entry, target, stop, add, and close work for the same managed
position. Expand plan statuses and worker claims to handle exits even after
first_target_filled or needs_attention. Suppress target recreation during/after
a full close. The current worker only supports GET/POST; add explicit cancel and
replace operations with reconciliation of uncertain outcomes.

Use provider event IDs where available. Include action and normalized instruction
fields in conflict checks. Without a provider ID, deduplicate against the matched
trade lifecycle and milestone, not only the calendar day. A duplicate target
message must not sell twice. Stop updates must not reverse newer protection.
Retain permanent client order IDs and recover uncertain POSTs by lookup.

Keep the five existing duplicate/conflicting-instruction protections. Fixing the
parser should not make contradictory payloads valid. Store recognized/queued
signals before returning 202; distinguish that from a broker acceptance or fill.

## 5. Deliver in stages

1. **Parser and Preview:** build fixtures from every observed message family;
   support whitespace, joined words, optional wording, decimal strikes, and years.
   Preview shows asset, action, resolved date/plan, quantities, and policy gaps.
2. **Entry compatibility:** enable the expanded option BTO formats through the
   existing worker. Keep entry quantity and first-target behavior unchanged.
3. **Full option exits:** add durable action records, cancellation/reconciliation,
   plan matching, and close-all execution under an explicit route policy.
4. **Option target and stop updates:** add milestone tracking, partial-close sizing,
   runner protection, and coordination with existing first-target orders.
5. **Equity execution and DCA:** enable separately after their sizing/risk policies
   are configured. Until then, show parsed alerts with the configuration reason.

Before each execution stage: test retries, cancellation/fill races, partially
filled entries, already-closed positions, year ambiguity, out-of-order targets,
account isolation, and worker restart recovery. Verify the complete flow on a
paper account before enabling the corresponding action on live routes.

Do not automatically replay historical rejected alerts: their prices and trade
state may be stale. Use them as parser fixtures; any manual replay must revalidate
the current position and use an explicit recovery action.

## Decisions needed before execution changes

The user confirmed market full closes, one contract per new option target while
retaining one runner, crediting existing first-target fills, and activating raised
broker stops. Those rules are implemented. Equity sizing and DCA limits remain
unspecified; those alerts are parsed and shown as Needs configuration.

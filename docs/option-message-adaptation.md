# Incoming option messages and closing alerts

Recent events now includes an expandable Incoming message column. Rejected
requests display the stored request_payload.message; accepted option plans display
original_message. Whitespace and line breaks are preserved. Authentication fields
and the full request envelope are not returned. Older records without stored
message text display a dash. This is the decoded message, not a byte-for-byte HTTP
body capture. Deploy the function and frontend to activate this change; no schema
migration is needed.

## Why closing alerts fail

parseOptionMessage in src/utils/optionWebhook.ts accepts only the anchored BTO
entry format with an entry price and first target. receiveOptionMessage then
creates an entry plan; optionOrder always buys three contracts for that entry.
Closing instructions are not implemented. Relaxing that regex to accept STC would
therefore risk turning a close into another buy.

## Proposed adaptation

1. Keep transport decoding separate from signal parsing. Accept plain text and
   JSON message as today. Add provider-specific envelope adapters only for observed
   fields, rejecting conflicting instructions instead of choosing one silently.
2. Normalize spacing, line breaks, case, and known equivalent action labels. Use
   separate anchored grammars for BTO / Buy to open and STC / Sell to close.
   Map documented provider phrases such as partial close or close all through
   explicit adapters. Unrecognized or ambiguous messages remain rejected with a
   specific reason and the received message visible.
3. Return a discriminated signal: open (contract, entry price, first target),
   close_quantity (contract, positive integer quantity, order type and price), or
   close_all (contract, order type and price). Entry-only target validation must
   not apply to exits. Do not infer full close from missing quantity, or market
   execution from missing price. Require an explicit action and sizing policy.
4. Prefer a versioned structured JSON contract for providers able to supply it.
   For example:

   ```json
   {"version":1,"event_id":"provider-close-123","action":"sell_to_close","symbol":"AAPL261009C00335000","quantity":2,"order_type":"limit","limit_price":"2.10"}
   ```

   This is a proposed schema, not an executable payload supported by the current
   option message path. Resolve text expiration against the matching active plan;
   do not reuse entry's next-year rollover for a closing alert. Require an explicit
   year or reject ambiguous plan matches.
5. Dispatch exits through a dedicated durable worker pinned to the route's broker
   account. Reconcile entry fills and current holdings, including reserved sell
   quantity. Cancel the plan's outstanding target and confirm cancellation or its
   terminal fill before sizing the close. Re-read holdings after reconciliation;
   reject quantities beyond the available long position. Submit sell_to_close,
   persist broker IDs, and reconcile fills. Define how partial closes affect any
   replacement target. Never blindly sell three contracts or silently reopen a
   position. Allow exits under the existing entry kill switch policy.
6. Deduplicate with provider event IDs and persisted client order IDs. Include
   action, quantity, execution type, and price in normalized identity/conflict
   checks. Serialize target and close processing per plan so concurrent deliveries
   cannot oversell. Use existing uncertainty recovery rather than repeating POST.
7. Extend Preview to show normalized action, resolved plan, quantity, account,
   cancellation requirements, and proposed order without placing it. Test exact
   observed provider messages, malformed/ambiguous input, retries, partial fills,
   target-fill/cancel races, and account isolation before paper verification.

## Next input needed

Copy the rejected closing messages from View message and group them by intended
behavior (close a specified quantity, close all, or update a target). Those exact
samples define the provider adapters and regression fixtures. The screenshots
contain only parser errors, so they cannot establish the actual closing syntax
or intended quantities. Execution support remains unchanged by the visibility fix.

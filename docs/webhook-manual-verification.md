# Verify webhooks after deployment

1. Refresh https://algofin138.vercel.app/ and open Webhooks.
2. On Option orders - Paper, verify PAPER and the intended Alpaca account.
3. Open Test Webhook. Set content type to Plain text and payload to `malformed`. Send and confirm. Expect HTTP 400 with a parser error, not Route not found. This does not place an order.
4. For parsing without an order, use Preview message with your actual option message. Verify symbol, expiration, entry, and target.
5. For a real paper order, use Test Webhook with JSON and a currently listed contract:

```json
{
  "event_id": "my-paper-test-001",
  "message": "PLTR: 190P 10/16: BTO Buy to open at 6.65 with first target above 7.65"
}
```

The example is illustrative: choose the contract and prices you intend to trade. Sending a valid payload can place an order. Expect HTTP 202 and a plan_id. A 202 response means queued, not broker acceptance or fill. Check Operations and Alpaca for the final outcome. Market closure does not necessarily prevent acceptance; filling requires an eligible session and price.

6. Verify entry: 3 contracts, buy_to_open, limit, DAY. After at least one entry contract fills, verify the first target: 1 contract, sell_to_close, limit, GTC. Two contracts remain after that target fills.
7. Retry the identical JSON using the same event_id only to check duplicate protection. Expect the same plan_id and duplicate=true. New event IDs represent new intended orders. After a network error, inspect events and Alpaca before retrying.
8. To verify creation, create an INACTIVE paper webhook. Verify its URL appears. Delete that temporary route using Delete webhook and confirm. It should disappear and the old URL should reject future requests. Deletion preserves existing orders, plans, and historical records; it does not cancel orders. Keep operational routes.

Test Webhook sends the supplied body directly to the selected webhook URL. Preview message performs validation only. No arbitrary proxy endpoint is required.

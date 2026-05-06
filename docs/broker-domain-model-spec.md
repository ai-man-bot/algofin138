# Broker Domain Model Spec

Date: 2026-05-06

## Purpose

This spec defines the normalized broker model that Sprint 2 should use when moving Alpaca-specific reads and writes behind platform-level interfaces.

## Design Principles

- UI components should consume normalized platform fields first and only read raw broker payloads for debugging.
- Broker adapters own provider-specific parsing, naming differences, and capability mapping.
- Order routing must check broker capabilities before submitting unsupported instructions.
- Every normalized entity keeps `raw` for diagnostics, but `raw` is not part of the stable UI contract.

## Entities

### Broker Connection

Represents a connected broker account or manual/offline broker placeholder.

Required fields:

- `id`: stable platform broker connection id.
- `provider`: `alpaca`, `interactive_brokers`, `manual`, or `unknown`.
- `brokerType`: provider-specific type label.
- `name`: display name.
- `accountId`: provider account identifier when available.
- `status`: `connected` or `disconnected`.
- `connected`: boolean mirror for simple UI checks.
- `connectedAt`: ISO timestamp or `null`.
- `capabilities`: capability flags.
- `raw`: provider payload.

### Capability Flags

Initial Sprint 2 flags:

- `supportsEquities`
- `supportsOptions`
- `supportsCrypto`
- `supportsFractionalShares`
- `supportsBracketOrders`
- `supportsTrailingStops`
- `supportsStreamingData`

Sprint 3 can extend this with multi-leg options, OCO, IOC/FOK, GTD, extended-hours, and short-selling constraints.

### Broker Account

Required normalized fields:

- `equity`
- `lastEquity`
- `buyingPower`
- `cash`
- `dayChange`
- `dayChangePercent`
- `notionalExposure`
- `raw`

### Position

Required normalized fields:

- `id`
- `symbol`
- `side`: `long` or `short`.
- `quantity`
- `averageEntryPrice`
- `currentPrice`
- `marketValue`
- `costBasis`
- `unrealizedPnL`
- `unrealizedPnLPercent`
- `intradayPnL`
- `intradayPnLPercent`
- `raw`

Compatibility aliases can remain temporarily for existing Alpaca-shaped UI code, but new code should use the normalized camelCase fields.

### Order

Required normalized fields:

- `id`
- `symbol`
- `side`
- `status`
- `orderType`
- `timeInForce`
- `quantity`
- `filledQuantity`
- `averageFillPrice`
- `limitPrice`
- `stopPrice`
- `submittedAt`
- `filledAt`
- `createdAt`
- `updatedAt`
- `estimatedNotional`
- `isOpen`
- `isFilled`
- `raw`

## Adapter Boundary

Sprint 2 should keep adapter functions in `src/utils/brokerModels.ts` until backend normalization is available. The current Alpaca adapter functions already cover connection, account, position, and order reads. Backend routes should later return these normalized shapes directly so frontend code does not need to know provider formats.

## Sprint 2 Acceptance Criteria

- Dashboard and trades views render from normalized broker account, position, and order fields.
- Alpaca-specific fields are isolated to adapters or compatibility aliases.
- Risk checks receive normalized account, position, and open-order data.
- Capability flags are available before any advanced order or options workflow is shown.

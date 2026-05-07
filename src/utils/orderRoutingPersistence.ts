import type { PlatformOrderLifecycle, StrategySignal } from './orderLifecycle.ts';
import type { RiskAuditRecord, RiskDecision } from './riskEngine.ts';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeSymbol(value: unknown) {
  const symbol = normalizeText(value).toUpperCase();
  if (!symbol) {
    throw new Error('StrategyLab signal symbol is required');
  }
  return symbol;
}

function normalizeSide(value: unknown) {
  const side = normalizeText(value).toLowerCase();
  if (side === 'buy' || side === 'sell') {
    return side;
  }
  throw new Error('StrategyLab signal side must be buy or sell');
}

function normalizeNumber(value: unknown, fieldName: string) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(parsed)) {
    throw new Error(`StrategyLab signal ${fieldName} must be a finite number`);
  }

  return parsed;
}

function inferAssetClass(symbol: string, explicitAssetClass?: unknown) {
  const assetClass = normalizeText(explicitAssetClass).toLowerCase();
  if (assetClass === 'equity' || assetClass === 'option' || assetClass === 'crypto') {
    return assetClass;
  }

  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(symbol)) {
    return 'option';
  }

  return 'equity';
}

function buildWebhookPath(routeToken: string) {
  return `/functions/v1/webhook-listener?token=${encodeURIComponent(routeToken)}`;
}

export function buildStrategyLabSignalFromPayload(
  payload: Record<string, any>,
  options: {
    fallbackSource: StrategySignal['signalSource'];
    strategyId?: string | null;
  },
): StrategySignal {
  const side = normalizeSide(payload.side ?? payload.action);
  const symbol = normalizeSymbol(payload.symbol);
  const quantity = normalizeNumber(payload.quantity ?? payload.qty, 'quantity');
  const strategyId = normalizeText(payload.strategy_id ?? payload.strategyId ?? options.strategyId) || undefined;
  const routeToken = normalizeText(payload.route_token ?? payload.routeToken ?? payload.token) || undefined;
  const signalSource =
    (normalizeText(payload.source).toLowerCase() as StrategySignal['signalSource']) ||
    options.fallbackSource;

  return {
    strategyId,
    symbol,
    assetClass: inferAssetClass(symbol, payload.asset_class ?? payload.assetClass),
    side,
    quantity,
    orderType: normalizeText(payload.order_type ?? payload.orderType).toLowerCase() || 'market',
    timeInForce: normalizeText(payload.time_in_force ?? payload.timeInForce).toLowerCase() || 'day',
    limitPrice:
      payload.limit_price != null || payload.limitPrice != null
        ? normalizeNumber(payload.limit_price ?? payload.limitPrice, 'limit price')
        : undefined,
    stopPrice:
      payload.stop_price != null || payload.stopPrice != null
        ? normalizeNumber(payload.stop_price ?? payload.stopPrice, 'stop price')
        : undefined,
    marketPrice:
      payload.price != null || payload.market_price != null || payload.marketPrice != null
        ? normalizeNumber(payload.price ?? payload.market_price ?? payload.marketPrice, 'price')
        : undefined,
    signalSource,
    generatedAt: normalizeText(payload.timestamp ?? payload.generated_at ?? payload.generatedAt) || new Date().toISOString(),
    metadata: {
      routeToken,
      originalPayload: payload,
    },
  };
}

export function buildRiskAuditInsertRow(auditRecord: RiskAuditRecord) {
  return {
    id: auditRecord.id,
    user_id: auditRecord.userId,
    source: auditRecord.source,
    broker_id: auditRecord.brokerId,
    status: auditRecord.status,
    summary: auditRecord.summary,
    issue_codes: auditRecord.issueCodes,
    issues: auditRecord.issues,
    estimated_order_notional: auditRecord.estimatedOrderNotional,
    projected_notional_exposure: auditRecord.projectedNotionalExposure,
    order_payload: auditRecord.order,
    created_at: auditRecord.createdAt,
  };
}

export function buildOmsOrderInsertRow(userId: string, order: PlatformOrderLifecycle) {
  return {
    user_id: userId,
    broker_id: order.brokerId,
    strategy_id: order.strategyId ?? null,
    source: order.source,
    asset_class: order.assetClass,
    instrument_type: order.instrumentType,
    status: order.status,
    estimated_notional: order.estimatedNotional,
    filled_quantity: order.filledQuantity,
    average_fill_price: order.averageFillPrice,
    legs: order.legs,
    instructions: order.instructions,
    capability_warnings: order.capabilityWarnings,
    raw_signal: order.rawSignal ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function buildStrategyLabExportRow(input: {
  userId: string;
  strategyId: string;
  routeId: string;
  routeToken: string;
  mode: string;
  alertPayload: Record<string, any>;
  generatedPineScript: string;
  webhookBaseUrl?: string | null;
}) {
  const routeToken = normalizeText(input.routeToken);
  const webhookPath = buildWebhookPath(routeToken);
  const webhookUrl = input.webhookBaseUrl
    ? `${String(input.webhookBaseUrl).replace(/\/$/, '')}${webhookPath}`
    : null;

  return {
    user_id: input.userId,
    strategy_id: input.strategyId,
    route_id: input.routeId,
    route_token: routeToken,
    export_mode: normalizeText(input.mode) || 'paper',
    source: 'strategylab_pinescript',
    alert_payload: input.alertPayload,
    generated_pinescript: input.generatedPineScript,
    webhook_path: webhookPath,
    webhook_url: webhookUrl,
    updated_at: new Date().toISOString(),
  };
}

export function buildWebhookEventStatusUpdate(input: {
  status: 'accepted' | 'blocked' | 'received';
  orderId?: string | null;
  auditRecordId?: string | null;
  riskDecision?: RiskDecision | null;
  exportId?: string | null;
}) {
  return {
    status: input.status,
    order_id: input.orderId ?? null,
    risk_audit_record_id: input.auditRecordId ?? null,
    strategy_lab_export_id: input.exportId ?? null,
    decision_summary: input.riskDecision?.summary ?? null,
    decision_payload: input.riskDecision ?? null,
  };
}

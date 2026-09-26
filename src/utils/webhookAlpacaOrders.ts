function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeOrderType(value: unknown) {
  const type = normalizeText(value).toLowerCase() || 'market';
  if (['market', 'limit', 'stop', 'stop_limit'].includes(type)) {
    return type;
  }
  throw new Error(`Unsupported Alpaca order type: ${type}`);
}

function normalizeSide(value: unknown) {
  const side = normalizeText(value).toLowerCase();
  if (side === 'buy' || side === 'sell') {
    return side;
  }
  throw new Error('Webhook order side must be buy or sell');
}

function normalizePositiveNumber(value: unknown, fieldName: string) {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`Webhook order ${fieldName} must be a positive number`);
  }

  return numberValue;
}

export function buildAlpacaOrderFromWebhookPayload(
  payload: Record<string, any>,
  options: {
    clientOrderId: string;
  },
) {
  const symbol = normalizeText(payload.symbol).toUpperCase();
  if (!symbol) {
    throw new Error('Webhook order symbol is required');
  }

  const side = normalizeSide(payload.side ?? payload.action);
  const type = normalizeOrderType(payload.order_type ?? payload.orderType ?? payload.type);
  const qty = normalizePositiveNumber(payload.qty ?? payload.quantity, 'quantity');
  const timeInForce = normalizeText(payload.time_in_force ?? payload.timeInForce).toLowerCase() || 'day';

  const order: Record<string, any> = {
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
    client_order_id: options.clientOrderId,
  };

  if (type === 'limit' || type === 'stop_limit') {
    const limitPrice = normalizePositiveNumber(
      payload.limit_price ?? payload.limitPrice ?? payload.price,
      'limit price',
    );
    order.limit_price = String(limitPrice);
  }

  if (type === 'stop' || type === 'stop_limit') {
    const stopPrice = normalizePositiveNumber(
      payload.stop_price ?? payload.stopPrice,
      'stop price',
    );
    order.stop_price = String(stopPrice);
  }

  return order;
}

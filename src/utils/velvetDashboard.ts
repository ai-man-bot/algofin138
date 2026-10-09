export type VelvetKpiSource = {
  equity?: number;
  buyingPower?: number;
  dayChange?: number;
  totalPnl?: number;
  dayChangePercent?: number;
  brokerId?: string;
};

export type VelvetOrder = {
  symbol?: string;
  asset?: string;
  side?: string;
  action?: string;
  quantity?: number | string;
  qty?: number | string;
  price?: number | string;
  averageFillPrice?: number | string;
  status?: string;
  broker?: string;
  source?: string;
  submittedAt?: string;
  filledAt?: string;
  time?: string;
};

export type VelvetPosition = {
  asset?: string;
  symbol?: string;
  qty?: number | string;
  quantity?: number | string;
  price?: number | string;
  currentPrice?: number | string;
  pl?: number | string;
  unrealizedPnL?: number | string;
  plPercent?: number | string;
  unrealizedPnLPercent?: number | string;
  broker?: string;
  strategy?: string;
};

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function aggregateBrokerKpis(sources: VelvetKpiSource[]) {
  return sources.reduce(
    (total, source) => ({
      equity: total.equity + finite(source.equity),
      buyingPower: total.buyingPower + finite(source.buyingPower),
      dayChange: total.dayChange + finite(source.dayChange),
      totalPnl: total.totalPnl + finite(source.totalPnl),
      dayChangePercent: total.equity + finite(source.equity) === 0
        ? 0
        : ((total.dayChange + finite(source.dayChange)) / (total.equity + finite(source.equity))) * 100,
    }),
    { equity: 0, buyingPower: 0, dayChange: 0, totalPnl: 0, dayChangePercent: 0 },
  );
}

export function mapRecentOrders(orders: VelvetOrder[], limit = 6) {
  return [...orders]
    .sort((a, b) =>
      new Date(b.filledAt || b.submittedAt || b.time || 0).getTime() -
      new Date(a.filledAt || a.submittedAt || a.time || 0).getTime(),
    )
    .slice(0, limit)
    .map((order) => {
      const side = String(order.side || order.action || 'buy').toUpperCase();
      const quantity = finite(order.quantity ?? order.qty);
      const price = finite(order.averageFillPrice ?? order.price);
      return {
        symbol: String(order.symbol || order.asset || 'N/A').toUpperCase(),
        side,
        quantity,
        price,
        total: quantity * price,
        broker: String(order.broker || 'Alpaca'),
        source: String(order.source || 'AlgoFin'),
        status: String(order.status || 'unknown').toUpperCase(),
        time: order.filledAt || order.submittedAt || order.time || '',
      };
    });
}

export function summarizePositions(positions: VelvetPosition[]) {
  return positions.map((position) => ({
    symbol: String(position.symbol || position.asset || 'N/A').toUpperCase(),
    quantity: finite(position.quantity ?? position.qty),
    price: finite(position.currentPrice ?? position.price),
    pnl: finite(position.unrealizedPnL ?? position.pl),
    pnlPercent: finite(position.unrealizedPnLPercent ?? position.plPercent),
    broker: String(position.broker || 'Alpaca'),
    strategy: String(position.strategy || 'Manual'),
  }));
}

export function buildActivityRows(input: {
  positions?: VelvetPosition[];
  orders?: VelvetOrder[];
  notifications?: { title?: string; message?: string; type?: string; createdAt?: string; timestamp?: string }[];
}) {
  const positionRows = summarizePositions(input.positions || []).slice(0, 3).map((position) => ({
    tone: position.pnl >= 0 ? 'pos' : 'neg',
    source: position.symbol,
    headline: `${position.symbol} ${position.pnl >= 0 ? 'up' : 'down'} ${Math.abs(position.pnlPercent).toFixed(2)}% in open position`,
    time: 'portfolio',
  }));

  const orderRows = mapRecentOrders(input.orders || [], 3).map((order) => ({
    tone: order.side === 'BUY' ? 'pos' : 'neg',
    source: order.broker,
    headline: `${order.side} ${order.quantity || ''} ${order.symbol} ${order.status.toLowerCase()}`,
    time: order.time ? new Date(order.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'recent',
  }));

  const notificationRows = (input.notifications || []).slice(0, 3).map((notification) => ({
    tone: String(notification.type || '').includes('reject') || String(notification.type || '').includes('error') ? 'neg' : 'primary',
    source: notification.type || 'Alert',
    headline: notification.title || notification.message || 'AlgoFin alert',
    time: notification.createdAt || notification.timestamp || 'recent',
  }));

  return [...notificationRows, ...orderRows, ...positionRows].slice(0, 6);
}

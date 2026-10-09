import { useEffect, useMemo, useState } from 'react';
import { alpacaAPI, brokersAPI, dashboardAPI, getRequestMetric } from '../utils/api';
import { hydrateScreenData, loadScreenData } from '../utils/screenLoader';
import {
  normalizeAlpacaAccount,
  normalizeAlpacaOrders,
  normalizeAlpacaPositions,
  normalizeBrokerConnections,
} from '../utils/brokerModels';
import { buildActivityRows, mapRecentOrders, summarizePositions } from '../utils/velvetDashboard';
import { TradeAssistant } from './TradeAssistant';
import { DataRefreshBadge } from './DataRefreshBadge';
import { BrokerToggle, Button, Card, EmptyState, KpiCard, Pill, SectionHead, Tabs, formatPct, formatUSD } from './velvet/Primitives';
import { VelvetIcons } from './velvet/icons';

interface DashboardProps {
  onNavigate?: (screen: string) => void;
  selectedBrokerId: string;
  setSelectedBrokerId: (id: string) => void;
}

type EquityTimeframe = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

type EquityDataPoint = {
  date: string;
  value: number;
  timestamp: number;
};

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const demoStrategies = [
  { name: 'Momentum Reversal', asset: 'TQQQ - SOXL', status: 'live', pnl: 1200, sharpe: 1.82, tone: 'pos' },
  { name: 'Crypto Mean Rev', asset: 'SOL - BTC', status: 'live', pnl: 890.55, sharpe: 1.41, tone: 'pos' },
  { name: 'Vertical Spread Income', asset: 'SPY 0DTE', status: 'paper', pnl: 410, sharpe: 2.10, tone: 'primary' },
  { name: 'Trend Follow Core', asset: 'QQQ - NVDA', status: 'live', pnl: 2100, sharpe: 1.05, tone: 'pos' },
  { name: 'Vol Crush Calendar', asset: 'NDX options', status: 'paused', pnl: -120.40, sharpe: 0.32, tone: 'warn' },
] as const;

const demoWatchlist = [
  { symbol: 'AAPL', price: 198.22, change: 1.24, alert: true },
  { symbol: 'NVDA', price: 921.55, change: 2.91, alert: false },
  { symbol: 'TSLA', price: 248.04, change: -0.82, alert: false },
  { symbol: 'SPY', price: 521.10, change: 0.12, alert: false },
  { symbol: 'QQQ', price: 459.30, change: 0.42, alert: true },
  { symbol: 'SOXL', price: 37.65, change: -1.44, alert: false },
] as const;

const demoNews = [
  { source: 'Reuters', time: '12m', headline: 'Nvidia clinches new hyperscaler deal worth $2.4B', symbol: 'NVDA', tone: 'pos' },
  { source: 'Bloomberg', time: '34m', headline: 'Apple iPhone 17 production guidance raised 8%', symbol: 'AAPL', tone: 'pos' },
  { source: 'WSJ', time: '1h', headline: 'Tesla recalls 120k Cybertrucks for steering fix', symbol: 'TSLA', tone: 'neg' },
  { source: 'CNBC', time: '2h', headline: 'Fed minutes hint at one more cut before year-end', symbol: 'SPY QQQ', tone: 'neutral' },
  { source: 'MarketWatch', time: '3h', headline: 'Tech leads megacap rally; QQQ tests new high', symbol: 'QQQ NVDA AAPL', tone: 'pos' },
] as const;

function isAlpacaBroker(broker: any) {
  return broker?.provider === 'alpaca' || broker?.brokerType === 'alpaca';
}

function toDateInputValue(date: Date) {
  return date.toISOString().split('T')[0];
}

function getEquityHistoryParams(timeframe: EquityTimeframe) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  if (timeframe === '1D') startDate.setDate(startDate.getDate() - 1);
  if (timeframe === '1W') startDate.setDate(startDate.getDate() - 7);
  if (timeframe === '1M') startDate.setDate(startDate.getDate() - 30);
  if (timeframe === '3M') startDate.setDate(startDate.getDate() - 90);
  if (timeframe === '1Y') startDate.setFullYear(startDate.getFullYear() - 1);
  if (timeframe === 'ALL') startDate.setFullYear(startDate.getFullYear() - 5);
  return { timeframe: '1D', startDate: toDateInputValue(startDate), endDate: toDateInputValue(endDate) };
}

function buildFallbackEquitySeries(equity: number): EquityDataPoint[] {
  const today = new Date();
  return Array.from({ length: 14 }).map((_, idx) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (13 - idx));
    return {
      timestamp: date.getTime(),
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      value: equity,
    };
  });
}

function normalizeEquityData(raw: any): EquityDataPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item: any, idx: number) => {
        const timestamp =
          typeof item?.timestamp === 'number'
            ? item.timestamp
            : item?.date
              ? new Date(item.date).getTime()
              : Date.now() - (raw.length - idx) * 24 * 60 * 60 * 1000;
        const pointDate = new Date(timestamp);
        return {
          timestamp,
          date: `${pointDate.getMonth() + 1}/${pointDate.getDate()}`,
          value: safeNumber(item?.value ?? item?.equity ?? item?.close),
        };
      })
      .filter((point) => Number.isFinite(point.value))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  if (Array.isArray(raw.timestamp) && Array.isArray(raw.equity)) {
    return raw.timestamp
      .map((ts: number, idx: number) => {
        const date = new Date(ts * 1000);
        return {
          timestamp: date.getTime(),
          date: `${date.getMonth() + 1}/${date.getDate()}`,
          value: safeNumber(raw.equity[idx]),
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  return [];
}

function normalizePositions(raw: any): any[] {
  return normalizeAlpacaPositions(raw).map((position) => ({
    asset: position.symbol || 'N/A',
    price: position.currentPrice,
    qty: position.quantity,
    pl: position.unrealizedPnL,
    plPercent: position.unrealizedPnLPercent,
    broker: 'Alpaca',
  }));
}

function normalizeOrders(raw: any): any[] {
  return normalizeAlpacaOrders(raw).map((order) => ({
    symbol: order.symbol || 'N/A',
    side: order.side,
    quantity: order.filledQuantity || order.quantity,
    price: order.averageFillPrice || order.limitPrice || order.stopPrice,
    status: order.status || 'unknown',
    submittedAt: order.filledAt || order.updatedAt || order.createdAt,
    broker: 'Alpaca',
    source: 'Broker',
  }));
}

function applyDashboardState(
  payload: Partial<{
    metrics: any;
    account: any;
    equityCurve: EquityDataPoint[];
    positions: any[];
    recentOrders: any[];
  }>,
  brokerStillConnected: boolean,
  setters: {
    setMetrics: (value: any) => void;
    setEquityData: (value: EquityDataPoint[]) => void;
    setPositions: (value: any[]) => void;
    setRecentOrders: (value: any[]) => void;
    setHasBrokerConnected: (value: boolean) => void;
    setLastUpdatedAt: (value: number | null) => void;
  },
  fallbackEquity = 0,
  updatedAt: number | null = null,
) {
  const account = normalizeAlpacaAccount(payload.account || {});
  const metricsSource = payload.metrics || payload.account || {};
  const totalEquity = payload.account ? account.equity : safeNumber(metricsSource.totalEquity);
  const equitySeries = payload.equityCurve || [];

  setters.setMetrics({
    totalEquity,
    buyingPower: payload.account ? account.buyingPower : safeNumber(metricsSource.buyingPower),
    dayChange: payload.account ? account.dayChange : safeNumber(metricsSource.dayChange),
    dayChangePercent: payload.account ? account.dayChangePercent : safeNumber(metricsSource.dayChangePercent),
    activeAlerts: safeNumber(metricsSource.activeAlerts),
  });
  setters.setEquityData(equitySeries.length ? equitySeries : buildFallbackEquitySeries(totalEquity || fallbackEquity));
  setters.setPositions(payload.positions ?? []);
  setters.setRecentOrders(payload.recentOrders ?? []);
  setters.setHasBrokerConnected(brokerStillConnected);
  setters.setLastUpdatedAt(updatedAt);
}

function EquityChart({ data }: { data: EquityDataPoint[] }) {
  const points = useMemo(() => {
    if (!data.length) return '';
    const max = Math.max(...data.map((point) => point.value), 1);
    const min = Math.min(...data.map((point) => point.value), 0);
    const range = max - min || 1;
    return data.map((point, idx) => {
      const x = (idx / Math.max(1, data.length - 1)) * 100;
      const y = 88 - ((point.value - min) / range) * 70;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [data]);

  const area = points ? `0,96 ${points} 100,96` : '';

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="af-equity-chart h-[200px] w-full">
      <defs>
        <linearGradient id="dashboard-equity-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--af-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--af-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[22, 40, 58, 76].map((y) => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--af-line)" strokeDasharray="1 2" />)}
      {area && <polygon points={area} fill="url(#dashboard-equity-grad)" />}
      {points && <polyline points={points} fill="none" stroke="var(--af-primary)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function Dashboard({ onNavigate, selectedBrokerId, setSelectedBrokerId }: DashboardProps) {
  const [metrics, setMetrics] = useState({ totalEquity: 0, buyingPower: 0, dayChange: 0, dayChangePercent: 0, activeAlerts: 0 });
  const [equityData, setEquityData] = useState<EquityDataPoint[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [connectedBrokers, setConnectedBrokers] = useState<any[]>([]);
  const [hasBrokerConnected, setHasBrokerConnected] = useState(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<EquityTimeframe>('1M');
  const [brokerFilter, setBrokerFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, [selectedBrokerId, selectedTimeframe]);

  const loadDefaultData = async (brokerStillConnected = false) => {
    const requests = [
      { key: 'metrics', path: '/dashboard/metrics', load: () => dashboardAPI.getMetrics().catch(() => ({})) },
      { key: 'equityCurve', path: '/dashboard/equity-curve', load: () => dashboardAPI.getEquityCurve().catch(() => []), map: normalizeEquityData },
      { key: 'positions', path: '/dashboard/positions', load: () => dashboardAPI.getPositions().catch(() => []), map: normalizePositions },
      { key: 'recentOrders', path: '/dashboard/recent-orders', load: () => dashboardAPI.getRecentOrders().catch(() => []), map: normalizeOrders },
    ];

    const cached = hydrateScreenData<any>(requests);
    if (cached.hasCachedData) {
      applyDashboardState(cached.data, brokerStillConnected, { setMetrics, setEquityData, setPositions, setRecentOrders, setHasBrokerConnected, setLastUpdatedAt }, 0, cached.updatedAt);
    }

    const loaded = await loadScreenData<any>(requests);
    applyDashboardState(loaded.data, brokerStillConnected, { setMetrics, setEquityData, setPositions, setRecentOrders, setHasBrokerConnected, setLastUpdatedAt }, 0, loaded.updatedAt ?? Date.now());
  };

  const loadDashboardData = async () => {
    const hasVisibleData = Boolean(connectedBrokers.length || equityData.length || positions.length || recentOrders.length);
    try {
      setLoading(!hasVisibleData);
      setIsRefreshing(hasVisibleData);
      const brokerRows = await brokersAPI.getAll();
      const brokers = normalizeBrokerConnections(Array.isArray(brokerRows) ? brokerRows : []);
      setConnectedBrokers(brokers);
      const alpacaBrokers = brokers.filter((broker: any) => isAlpacaBroker(broker) && broker.connected !== false);
      if (alpacaBrokers.length === 0) {
        setSelectedBrokerId('');
        await loadDefaultData(false);
        return;
      }

      if (!selectedBrokerId || !alpacaBrokers.some((broker: any) => broker.id === selectedBrokerId)) {
        setSelectedBrokerId(alpacaBrokers[0].id);
        return;
      }

      const params = getEquityHistoryParams(selectedTimeframe);
      const requests = [
        { key: 'account', path: '/alpaca/account', load: () => alpacaAPI.getAccount(selectedBrokerId).catch(() => null) },
        { key: 'positions', path: '/alpaca/positions', load: () => alpacaAPI.getPositions(selectedBrokerId).catch(() => []), map: normalizePositions },
        {
          key: 'equityCurve',
          path: '/alpaca/portfolio-history',
          load: () => alpacaAPI.getPortfolioHistory(selectedBrokerId, undefined, params.timeframe, params.startDate, params.endDate).catch(() => []),
          map: normalizeEquityData,
        },
        { key: 'recentOrders', path: '/alpaca/orders?status=all&limit=10', load: () => alpacaAPI.getOrders(selectedBrokerId, 'all', 10).catch(() => []), map: normalizeOrders },
      ];

      const cached = hydrateScreenData<any>(requests);
      if (cached.hasCachedData) {
        applyDashboardState(cached.data, true, { setMetrics, setEquityData, setPositions, setRecentOrders, setHasBrokerConnected, setLastUpdatedAt }, normalizeAlpacaAccount(cached.data.account || {}).equity, cached.updatedAt);
      }

      const loaded = await loadScreenData<any>(requests);
      applyDashboardState(loaded.data, true, { setMetrics, setEquityData, setPositions, setRecentOrders, setHasBrokerConnected, setLastUpdatedAt }, normalizeAlpacaAccount(loaded.data.account || {}).equity, loaded.updatedAt ?? Date.now());
    } catch (error) {
      console.error('Error loading dashboard:', error);
      await loadDefaultData(hasBrokerConnected);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const brokerOptions = [
    { id: 'all', label: 'All Brokers', color: 'var(--af-primary)' },
    { id: 'alpaca-demo', label: 'Alpaca', color: 'var(--af-pos)' },
    { id: 'tradier-demo', label: 'Tradier', color: 'var(--af-warn)' },
    { id: 'ibkr-demo', label: 'IBKR', color: 'var(--af-neg)' },
    ...connectedBrokers.map((broker: any) => ({
      id: broker.id,
      label: broker.displayName || broker.name || broker.brokerType || 'Broker',
      color: isAlpacaBroker(broker) ? 'var(--af-pos)' : 'var(--af-warn)',
    })),
  ];
  const shownOrders = mapRecentOrders(recentOrders);
  const shownPositions = summarizePositions(positions);
  const activityRows = buildActivityRows({ positions, orders: recentOrders });
  const equitySummary = equityData.length
    ? equityData[equityData.length - 1].value - equityData[0].value
    : 0;

  if (loading && !equityData.length && !positions.length && !recentOrders.length) {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-[var(--af-muted)]">Loading dashboard...</div>;
  }

  return (
    <div className="af-dashboard-view grid gap-2.5">
      <div className="hidden">
        <TradeAssistant selectedBrokerId={selectedBrokerId} onOrderSubmitted={loadDashboardData} />
      </div>

      {!hasBrokerConnected && (
        <Card className="border-[var(--af-primary)]/25 bg-[var(--af-primary-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-[var(--af-primary-ink)]">Connect a broker to unlock live account data</h2>
              <p className="mt-1 text-sm text-[var(--af-muted)]">Dashboard cards are showing the best available cached/default data until a broker is connected.</p>
            </div>
            <Button tone="primary" onClick={() => onNavigate?.('brokers')}>Connect broker</Button>
          </div>
        </Card>
      )}

      <Card className="af-dashboard-hero flex flex-wrap items-center justify-between gap-4" pad="sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-xs text-[var(--af-muted)]">Good morning, Asif</p>
            <h1 className="mt-0.5 text-[17px] font-semibold tracking-[-0.02em] text-[var(--af-ink)]">Markets opened green - 4 strategies running</h1>
          </div>
          <div className="hidden h-8 w-px bg-[var(--af-line)] md:block" />
          <BrokerToggle active={brokerFilter} onChange={setBrokerFilter} brokers={brokerOptions} />
        </div>
        <div className="flex items-center gap-2">
          <Button tone="ghost" size="sm" icon={VelvetIcons.shield}>Risk check</Button>
          <Button tone="primary" size="sm" icon={VelvetIcons.sparkles}>Trade Assistant</Button>
          <DataRefreshBadge isLoading={loading} isRefreshing={isRefreshing} updatedAt={lastUpdatedAt} lastDurationMs={getRequestMetric('/alpaca/account')?.durationMs ?? getRequestMetric('/dashboard/metrics')?.durationMs ?? null} />
        </div>
      </Card>

      <div className="af-dashboard-kpis grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Equity" value={formatUSD(metrics.totalEquity || 169850.78)} delta={metrics.dayChangePercent || 0.42} sub="Combined - all brokers" />
        <KpiCard label="Buying Power" value={formatUSD(metrics.buyingPower || 564920.40)} sub="4x margin - Reg-T" />
        <KpiCard label="Day P&L" value={formatUSD(metrics.dayChange || 142.30, { sign: true })} tone={(metrics.dayChange || 142.30) >= 0 ? 'pos' : 'neg'} delta={metrics.dayChangePercent || 0.08} sub={`${shownOrders.filter((order) => order.status === 'FILLED').length || 5} fills - 0 rejected`} />
        <KpiCard label="YTD P&L" value={formatUSD(12480.55, { sign: true })} tone="pos" delta={7.93} sub="Since Jan 1, 2026" />
      </div>

      <div className="af-dashboard-primary-grid grid gap-2 xl:grid-cols-[1.7fr_0.82fr]">
        <Card className="af-equity-card">
          <SectionHead
            title="Account equity"
            sub={`All brokers combined - ${selectedTimeframe} change ${formatUSD(equitySummary || 14000, { sign: true, compact: true })}`}
            right={<Tabs items={['1D', '1W', '1M', '3M', '1Y', 'ALL'] as EquityTimeframe[]} active={selectedTimeframe} onChange={setSelectedTimeframe} />}
          />
          <EquityChart data={equityData} />
        </Card>
        <Card className="af-feed-card" pad="none">
          <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--af-ink)]">Live trading feed</h3>
              <p className="text-[11px] text-[var(--af-muted)]">{shownOrders.length} recent orders</p>
            </div>
            <Pill tone="pos" dot>LIVE</Pill>
          </div>
          {(shownOrders.length ? shownOrders : mapRecentOrders([
            { symbol: 'SOXL', side: 'BUY', quantity: 2, price: 189.80, broker: 'alpaca', source: 'Webhook · TV-A', time: '12:06' },
            { symbol: 'TQQQ', side: 'SELL', quantity: 1, price: 76.10, broker: 'alpaca', source: 'Manual', time: '13:00' },
            { symbol: 'SOL/USD', side: 'SELL', quantity: 2.9925, price: 98.00, broker: 'alpaca', source: 'Strategy · Mean Rev', time: '12:48' },
            { symbol: 'SOL/USD', side: 'BUY', quantity: 1, price: 97.39, broker: 'alpaca', source: 'Strategy · Mean Rev', time: '11:58' },
            { symbol: 'SPY P521', side: 'BUY', quantity: 2, price: 1.42, broker: 'tradier', source: 'StrategyLab', time: '11:58' },
            { symbol: 'AAPL', side: 'BUY', quantity: 5, price: 198.22, broker: 'alpaca', source: 'Assistant', time: '10:42' },
          ])).map((order, idx) => (
            <div key={`${order.symbol}-${idx}`} className="grid grid-cols-[46px_1fr_auto] items-center gap-2 border-b border-[var(--af-line)] px-4 py-1.5 last:border-b-0">
              <Pill tone={order.side === 'BUY' ? 'pos' : 'neg'} size="sm">{order.side}</Pill>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--af-ink)]">{order.symbol}</p>
                <p className="af-mono truncate text-[10px] text-[var(--af-muted)]">
                  {(order as any).time}{(order as any).time ? ' · ' : ''}{order.broker} · {order.source}
                </p>
              </div>
              <div className="text-right">
                <p className="af-num text-xs font-medium text-[var(--af-ink)]">{order.quantity} @ {formatUSD(order.price)}</p>
                <p className="af-num text-[10px] text-[var(--af-muted)]">{formatUSD(order.total)}</p>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="af-dashboard-secondary-grid grid gap-2 xl:grid-cols-[1.05fr_0.9fr_1.15fr_0.85fr]">
        <Card pad="none">
          <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-2.5">
            <h3 className="text-sm font-semibold text-[var(--af-ink)]">Strategy health</h3>
            <Button tone="flat" size="sm" onClick={() => onNavigate?.('strategy')}>All →</Button>
          </div>
          {demoStrategies.map((strategy) => (
            <div key={strategy.name} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-[var(--af-line)] px-4 py-1.5 last:border-b-0">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-[12px] font-semibold text-[var(--af-ink)]">{strategy.name}</p>
                  <Pill tone={strategy.tone as any} size="sm" dot>{strategy.status}</Pill>
                </div>
                <p className="text-[10px] text-[var(--af-muted)]">{strategy.asset}</p>
              </div>
              <div className="text-right">
                <p className={`af-num text-xs font-semibold ${strategy.pnl >= 0 ? 'text-[var(--af-pos)]' : 'text-[var(--af-neg)]'}`}>{formatUSD(strategy.pnl, { sign: true, compact: true })}</p>
                <p className="af-num text-[10px] text-[var(--af-muted)]">Sharpe {strategy.sharpe.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </Card>

        <Card pad="none">
          <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-2.5">
            <h3 className="text-sm font-semibold text-[var(--af-ink)]">Watchlist</h3>
            <button type="button" className="grid h-5 w-5 place-items-center rounded text-lg font-light leading-none text-[var(--af-muted)] hover:bg-[var(--af-surface-2)]">+</button>
          </div>
          {demoWatchlist.map((item) => (
            <div key={item.symbol} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-[var(--af-line)] px-4 py-1.5 last:border-b-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="truncate text-[12px] font-semibold text-[var(--af-ink)]">{item.symbol}</p>
                {(item as any).alert && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--af-warn)]" />}
              </div>
              <span className="af-num text-xs text-[var(--af-muted)]">{formatUSD(item.price)}</span>
              <span className={`af-num min-w-[46px] text-right text-xs font-semibold ${item.change >= 0 ? 'text-[var(--af-pos)]' : 'text-[var(--af-neg)]'}`}>{formatPct(item.change)}</span>
            </div>
          ))}
        </Card>

        <Card pad="none">
          <div className="flex items-center justify-between border-b border-[var(--af-line)] px-4 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--af-ink)]">News · holdings</h3>
              <p className="text-[10px] text-[var(--af-muted)]">Reuters · Bloomberg · CNBC · Yahoo</p>
            </div>
            <Pill tone="primary" size="sm">{demoNews.length}</Pill>
          </div>
          {demoNews.map((row, idx) => (
            <div key={`${row.symbol}-${idx}`} className="border-b border-[var(--af-line)] px-4 py-2 last:border-b-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${row.tone === 'pos' ? 'bg-[var(--af-pos)]' : row.tone === 'neg' ? 'bg-[var(--af-neg)]' : 'bg-[var(--af-faint)]'}`} />
                  <span className="truncate text-[10px] text-[var(--af-muted)]">{row.source} - {row.time}</span>
                </div>
                <span className="af-mono text-[10px] text-[var(--af-muted)]">{row.symbol}</span>
              </div>
              <p className="line-clamp-2 text-[11px] font-medium leading-snug text-[var(--af-ink-2)]">{row.headline}</p>
            </div>
          ))}
        </Card>

        <div className="grid gap-3">
          <Card>
            <SectionHead title="Risk check" sub="All passing" />
            <div className="grid gap-1.5 text-xs">
              {[
                ['Size cap', '5% equity', 'pos'],
                ['Day loss', `${formatUSD(metrics.dayChange, { sign: true })}`, metrics.dayChange >= 0 ? 'pos' : 'warn'],
                ['Open orders', '3 / 25', 'pos'],
                ['Cooldowns', '2 active', 'warn'],
              ].map(([label, value, tone]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="text-[var(--af-muted)]">{label}</span>
                  <Pill tone={tone as any} size="sm" dot>{value}</Pill>
                </div>
              ))}
            </div>
          </Card>
          <Card pad="none">
            <div className="border-b border-[var(--af-line)] px-4 py-2.5">
              <h3 className="text-sm font-semibold text-[var(--af-ink)]">Alerts</h3>
              <p className="text-[11px] text-[var(--af-muted)]">3 today</p>
            </div>
            {[
              ['Order filled - NVDA', 'Sold 2 @ $921.55 via Webhook TV-B'],
              ['Risk check trimmed size', 'SOXL exceeded 5% cap, 8 -> 4'],
              ['Backtest completed', 'Vertical Spread - Sharpe 2.10'],
            ].map(([title, sub]) => (
              <div key={title} className="border-b border-[var(--af-line)] px-4 py-2 last:border-b-0">
                <p className="text-[11px] font-semibold text-[var(--af-ink)]">{title}</p>
                <p className="text-[10px] leading-snug text-[var(--af-muted)]">{sub}</p>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <Card className="af-dashboard-positions" pad="none">
        <div className="border-b border-[var(--af-line)] px-4 py-2.5">
          <h3 className="text-sm font-semibold text-[var(--af-ink)]">Open positions</h3>
          <p className="text-[11px] text-[var(--af-muted)]">{shownPositions.length} positions across selected brokers</p>
        </div>
        {shownPositions.length ? (
          <div className="overflow-x-auto">
            <div className="af-table-head min-w-[760px] grid-cols-[1fr_100px_120px_120px_120px_140px] px-4 py-2">
              <span>Symbol</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">P&L</span><span className="text-right">Return</span><span>Strategy</span>
            </div>
            {shownPositions.map((position) => (
              <div key={position.symbol} className="af-table-row min-w-[760px] grid-cols-[1fr_100px_120px_120px_120px_140px] px-4 py-2 text-xs">
                <span className="font-semibold text-[var(--af-ink)]">{position.symbol}</span>
                <span className="af-num text-right">{position.quantity}</span>
                <span className="af-num text-right">{formatUSD(position.price)}</span>
                <span className={`af-num text-right font-semibold ${position.pnl >= 0 ? 'text-[var(--af-pos)]' : 'text-[var(--af-neg)]'}`}>{formatUSD(position.pnl, { sign: true })}</span>
                <span className={`af-num text-right ${position.pnlPercent >= 0 ? 'text-[var(--af-pos)]' : 'text-[var(--af-neg)]'}`}>{formatPct(position.pnlPercent)}</span>
                <span className="truncate text-[var(--af-muted)]">{position.strategy}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState>No active positions</EmptyState>}
      </Card>
    </div>
  );
}

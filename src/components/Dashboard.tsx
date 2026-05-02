import React, { useState, useEffect } from 'react';
import {
  ArrowUp,
  ArrowDown,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Bell,
} from './CustomIcons';
import { CustomAreaChart } from './CustomAreaChart';
import { dashboardAPI, alpacaAPI, brokersAPI } from '../utils/api';
import { TradeAssistant } from './TradeAssistant';

interface DashboardProps {
  onNavigate?: (screen: string) => void;
  selectedBrokerId: string;
  setSelectedBrokerId: (id: string) => void;
}

type EquityTimeframe = '1M' | '3M' | '6M' | '1Y' | 'ALL';

interface EquityDataPoint {
  date: string;
  value: number;
  timestamp: number;
}

const safeNumber = (value: any, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatCurrency = (value: any) =>
  `$${safeNumber(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatPercent = (value: any) => `${safeNumber(value).toFixed(2)}%`;

function normalizeBroker(broker: any) {
  const brokerType =
    broker?.brokerType ||
    broker?.broker_type ||
    broker?.provider ||
    broker?.type ||
    'alpaca';

  const accountId =
    broker?.accountId ||
    broker?.account_id ||
    broker?.metadata?.account?.id ||
    broker?.metadata?.account?.account_number ||
    'N/A';

  const connectedAt =
    broker?.connectedAt ||
    broker?.connected_at ||
    broker?.created_at ||
    null;

  const connected =
    broker?.connected === true ||
    broker?.status === 'connected' ||
    broker?.status === 'active';

  return {
    ...broker,
    brokerType,
    accountId,
    connectedAt,
    connected,
    status: connected ? 'connected' : broker?.status,
    displayName: broker?.name || brokerType,
  };
}

function isAlpacaBroker(broker: any) {
  const brokerType =
    broker?.brokerType ||
    broker?.broker_type ||
    broker?.provider ||
    broker?.type;

  return brokerType === 'alpaca';
}

function toDateInputValue(date: Date) {
  return date.toISOString().split('T')[0];
}

function getEquityHistoryParams(timeframe: EquityTimeframe) {
  const endDate = new Date();
  const startDate = new Date(endDate);

  if (timeframe === '1M') startDate.setDate(startDate.getDate() - 30);
  if (timeframe === '3M') startDate.setDate(startDate.getDate() - 90);
  if (timeframe === '6M') startDate.setDate(startDate.getDate() - 180);
  if (timeframe === '1Y') startDate.setFullYear(startDate.getFullYear() - 1);
  if (timeframe === 'ALL') startDate.setFullYear(startDate.getFullYear() - 5);

  return {
    timeframe: '1D',
    startDate: toDateInputValue(startDate),
    endDate: toDateInputValue(endDate),
  };
}

function buildFallbackEquitySeries(equity: number): EquityDataPoint[] {
  const today = new Date();

  return Array.from({ length: 7 }).map((_, idx) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - idx));

    return {
      timestamp: date.getTime(),
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      value: equity,
    };
  });
}

function summarizeEquity(data: EquityDataPoint[]) {
  if (!data.length) {
    return { latest: 0, change: 0, changePercent: 0 };
  }

  const first = safeNumber(data[0]?.value);
  const latest = safeNumber(data[data.length - 1]?.value);
  const change = latest - first;
  const changePercent = first !== 0 ? (change / first) * 100 : 0;

  return { latest, change, changePercent };
}

function normalizeEquityData(raw: any): EquityDataPoint[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw
      .map((item: any, idx: number) => {
        const numericValue = safeNumber(item?.value ?? item?.equity ?? item?.close);

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
          value: numericValue,
        };
      })
      .filter((point: EquityDataPoint) => Number.isFinite(point.value))
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
      .filter((point: EquityDataPoint) => Number.isFinite(point.value))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  return [];
}

function normalizePositions(raw: any): any[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((pos: any) => ({
    asset: pos.asset || pos.symbol || 'N/A',
    price: safeNumber(pos.price ?? pos.current_price ?? pos.market_value),
    qty: safeNumber(pos.qty ?? pos.quantity),
    pl: safeNumber(pos.pl ?? pos.unrealized_pl),
    plPercent: safeNumber(pos.plPercent ?? pos.unrealized_plpc) * 100,
  }));
}

function normalizeOrders(raw: any): any[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((order: any) => {
    const filledTime = order.filled_at || order.updated_at || order.created_at || new Date().toISOString();
    const date = new Date(filledTime);

    return {
      time: date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
      action: String(order.action || order.side || 'BUY').toUpperCase(),
      symbol: order.symbol || 'N/A',
      qty: safeNumber(order.qty ?? order.filled_qty ?? order.quantity),
      price: safeNumber(order.price ?? order.filled_avg_price ?? order.entry_price),
      status: order.status || 'unknown',
    };
  });
}

export function Dashboard({ onNavigate, selectedBrokerId, setSelectedBrokerId }: DashboardProps) {
  const [metrics, setMetrics] = useState({
    totalEquity: 0,
    buyingPower: 0,
    dayChange: 0,
    dayChangePercent: 0,
    activeAlerts: 0,
  });

  const [equityData, setEquityData] = useState<EquityDataPoint[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasBrokerConnected, setHasBrokerConnected] = useState(false);
  const [connectedBrokers, setConnectedBrokers] = useState<any[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<EquityTimeframe>('1M');

  useEffect(() => {
    loadDashboardData();
  }, [selectedBrokerId, selectedTimeframe]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      const brokerRows = await brokersAPI.getAll();
      const brokers = (brokerRows || []).map(normalizeBroker);
      setConnectedBrokers(brokers);

      const alpacaBrokers = brokers.filter(
        (broker: any) => isAlpacaBroker(broker) && broker.connected !== false
      );

      const selectedBrokerStillExists = alpacaBrokers.some(
        (broker: any) => broker.id === selectedBrokerId
      );

      console.log('📊 Dashboard: Loaded brokers:', brokers);
      console.log('📊 Dashboard: Filtered Alpaca brokers:', alpacaBrokers);
      console.log('📊 Dashboard: Alpaca broker count:', alpacaBrokers.length);

      if (alpacaBrokers.length === 0) {
        setSelectedBrokerId('');
        await loadDefaultData(false);
        return;
      }

      if (!selectedBrokerId || !selectedBrokerStillExists) {
        setSelectedBrokerId(alpacaBrokers[0].id);
      }

      const activeBrokerId =
        selectedBrokerStillExists && selectedBrokerId
          ? selectedBrokerId
          : alpacaBrokers[0].id;

      try {
        const params = getEquityHistoryParams(selectedTimeframe);

        const [accountData, positionsData, portfolioHistory, ordersData] = await Promise.all([
          alpacaAPI.getAccount(activeBrokerId).catch(() => null),
          alpacaAPI.getPositions(activeBrokerId).catch(() => []),
          alpacaAPI
            .getPortfolioHistory(
              activeBrokerId,
              undefined,
              params.timeframe,
              params.startDate,
              params.endDate
            )
            .catch(() => []),
          alpacaAPI.getOrders(activeBrokerId, 'all', 10).catch(() => []),
        ]);

        const equity = safeNumber(accountData?.equity ?? accountData?.totalEquity);
        const lastEquity = safeNumber(accountData?.last_equity ?? accountData?.lastEquity ?? equity);
        const buyingPower = safeNumber(accountData?.buying_power ?? accountData?.buyingPower);
        const dayChange = equity - lastEquity;
        const dayChangePercent = lastEquity > 0 ? (dayChange / lastEquity) * 100 : 0;

        setMetrics({
          totalEquity: equity,
          buyingPower,
          dayChange,
          dayChangePercent,
          activeAlerts: safeNumber(accountData?.activeAlerts),
        });

        setPositions(normalizePositions(positionsData));
        setRecentOrders(normalizeOrders(ordersData));

        const normalizedEquity = normalizeEquityData(portfolioHistory);
        setEquityData(
          normalizedEquity.length > 0 ? normalizedEquity : buildFallbackEquitySeries(equity)
        );

        setHasBrokerConnected(true);
      } catch (alpacaError) {
        console.error('Error fetching Alpaca data:', alpacaError);
        await loadDefaultData(true);
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      await loadDefaultData(false);
    } finally {
      setLoading(false);
    }
  };

  const loadDefaultData = async (brokerStillConnected = false) => {
    try {
      const [metricsData, equityCurveData, positionsData, recentOrdersData] = await Promise.all([
        dashboardAPI.getMetrics().catch(() => null),
        dashboardAPI.getEquityCurve().catch(() => []),
        dashboardAPI.getPositions().catch(() => []),
        dashboardAPI.getRecentOrders().catch(() => []),
      ]);

      setMetrics({
        totalEquity: safeNumber(metricsData?.totalEquity),
        buyingPower: safeNumber(metricsData?.buyingPower),
        dayChange: safeNumber(metricsData?.dayChange),
        dayChangePercent: safeNumber(metricsData?.dayChangePercent),
        activeAlerts: safeNumber(metricsData?.activeAlerts),
      });

      setEquityData(normalizeEquityData(equityCurveData));
      setPositions(normalizePositions(positionsData));
      setRecentOrders(normalizeOrders(recentOrdersData));
      setHasBrokerConnected(brokerStillConnected);
    } catch (error) {
      console.error('Error loading default data:', error);

      setMetrics({
        totalEquity: 0,
        buyingPower: 0,
        dayChange: 0,
        dayChangePercent: 0,
        activeAlerts: 0,
      });

      setEquityData([]);
      setPositions([]);
      setRecentOrders([]);
      setHasBrokerConnected(brokerStillConnected);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-slate-400">Loading dashboard...</div>
      </div>
    );
  }

  const equitySummary = summarizeEquity(equityData);
  const timeframeOptions: EquityTimeframe[] = ['1M', '3M', '6M', '1Y', 'ALL'];
  const alpacaBrokersForSelect = connectedBrokers.filter((broker: any) => isAlpacaBroker(broker));

  return (
    <div className="min-h-screen bg-[#0f172a] mx-auto max-w-[1600px] px-6 py-8">
      <div className="mb-6">
        <TradeAssistant selectedBrokerId={selectedBrokerId} onOrderSubmitted={loadDashboardData} />
      </div>

      {!hasBrokerConnected && (
        <div className="mb-8 rounded-xl border border-blue-500/30 bg-blue-500/10 p-6 backdrop-blur-sm">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-blue-500/20 p-3">
              <Wallet className="h-6 w-6 text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="mb-2 text-lg text-slate-100">Connect Your Broker to Get Started</h3>
              <p className="mb-4 text-sm text-slate-400">
                Connect Alpaca or Interactive Brokers to view your account data, execute trades, and track performance in real-time.
              </p>
              <button
                onClick={() => (onNavigate ? onNavigate('brokers') : null)}
                className="rounded-lg bg-blue-500 px-6 py-2.5 text-sm transition-colors hover:bg-blue-600"
              >
                Connect Broker
              </button>
            </div>
          </div>
        </div>
      )}

      {hasBrokerConnected && alpacaBrokersForSelect.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-700/50 bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🦙</div>
            <div>
              <h4 className="text-sm text-slate-300">Viewing Account</h4>
              <p className="text-xs text-slate-500">Select an account to display</p>
            </div>
          </div>

          <select
            value={selectedBrokerId || alpacaBrokersForSelect[0]?.id || ''}
            onChange={(e) => setSelectedBrokerId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-white outline-none transition-colors focus:border-blue-500"
          >
            {alpacaBrokersForSelect.map((broker: any) => (
              <option key={broker.id} value={broker.id}>
                {broker.displayName || broker.name || 'Alpaca'} - {broker.accountId || 'N/A'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={<DollarSign className="h-6 w-6" />}
          title="Total Equity"
          value={formatCurrency(metrics.totalEquity)}
          change={`${safeNumber(metrics.dayChangePercent) >= 0 ? '+' : ''}${formatPercent(metrics.dayChangePercent)}`}
          positive={safeNumber(metrics.dayChangePercent) >= 0}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-400"
        />

        <MetricCard
          icon={<Wallet className="h-6 w-6" />}
          title="Buying Power"
          value={formatCurrency(metrics.buyingPower)}
          subtext="Available"
          iconBg="bg-cyan-500/10"
          iconColor="text-cyan-400"
        />

        <MetricCard
          icon={safeNumber(metrics.dayChange) >= 0 ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
          title="Day Change"
          value={formatCurrency(metrics.dayChange)}
          change={`${safeNumber(metrics.dayChangePercent) >= 0 ? '+' : ''}${formatPercent(metrics.dayChangePercent)}`}
          positive={safeNumber(metrics.dayChange) >= 0}
          iconBg={safeNumber(metrics.dayChange) >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}
          iconColor={safeNumber(metrics.dayChange) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
        />

        <MetricCard
          icon={<Bell className="h-6 w-6" />}
          title="Active Alerts"
          value={String(safeNumber(metrics.activeAlerts))}
          subtext="3 triggered today"
          iconBg="bg-rose-500/10"
          iconColor="text-rose-400"
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
          <div className="border-b border-slate-700/50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="mb-1 text-slate-100">Account Equity</h3>
                <p className="text-sm text-slate-400">
                  {equitySummary.latest > 0
                    ? `${selectedTimeframe} change: ${equitySummary.change >= 0 ? '+' : ''}${formatCurrency(Math.abs(equitySummary.change))} (${equitySummary.changePercent >= 0 ? '+' : ''}${formatPercent(equitySummary.changePercent)})`
                    : 'Portfolio value over time'}
                </p>
              </div>

              <div className="flex gap-2">
                {timeframeOptions.map((timeframe) => (
                  <button
                    key={timeframe}
                    onClick={() => setSelectedTimeframe(timeframe)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      selectedTimeframe === timeframe
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {equityData.length > 0 ? (
            <div className="h-[400px] w-full">
              <CustomAreaChart data={equityData} />
            </div>
          ) : (
            <div className="flex h-[400px] items-center justify-center text-slate-400">
              No equity data available
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
          <div className="border-b border-slate-700/50 p-6">
            <h3 className="text-slate-100">Live Trading Feed</h3>
            <p className="text-sm text-slate-400">Recent orders</p>
          </div>

          <div className="h-[400px] overflow-y-auto">
            {recentOrders.length > 0 ? (
              recentOrders.map((trade, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between border-b border-slate-700/30 p-4 transition-colors hover:bg-slate-800/30"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`rounded px-2 py-1 text-xs ${
                        trade.action === 'BUY'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {trade.action}
                    </div>
                    <div>
                      <div className="text-sm text-slate-100">{trade.symbol}</div>
                      <div className="text-xs text-slate-500">{trade.time}</div>
                    </div>
                  </div>

                  <div className="text-right font-mono text-sm">
                    <div className="text-slate-300">
                      {safeNumber(trade.qty)} @ {formatCurrency(trade.price)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {formatCurrency(safeNumber(trade.qty) * safeNumber(trade.price))}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex items-center justify-center p-12 text-slate-400">
                No recent orders
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm">
        <div className="border-b border-slate-700/50 p-6">
          <h3 className="text-slate-100">Active Positions</h3>
          <p className="text-sm text-slate-400">Current holdings</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-sm text-slate-400">
                <th className="p-4">Asset</th>
                <th className="p-4">Price</th>
                <th className="p-4">Qty</th>
                <th className="p-4">P/L</th>
              </tr>
            </thead>

            <tbody className="font-mono text-sm">
              {positions.length > 0 ? (
                positions.map((position, idx) => (
                  <tr key={idx} className="border-b border-slate-700/30 transition-colors hover:bg-slate-800/30">
                    <td className="p-4 text-slate-100">{position.asset}</td>
                    <td className="p-4 text-slate-300">{formatCurrency(position.price)}</td>
                    <td className="p-4 text-slate-300">{safeNumber(position.qty)}</td>
                    <td className="p-4">
                      <div className={safeNumber(position.pl) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {safeNumber(position.pl) >= 0 ? '+' : ''}
                        {formatCurrency(position.pl)}
                      </div>
                      <div
                        className={`text-xs ${
                          safeNumber(position.pl) >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'
                        }`}
                      >
                        {safeNumber(position.plPercent) >= 0 ? '+' : ''}
                        {formatPercent(position.plPercent)}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    No active positions
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  change?: string;
  positive?: boolean;
  subtext?: string;
  iconBg: string;
  iconColor: string;
}

function MetricCard({
  icon,
  title,
  value,
  change,
  positive,
  subtext,
  iconBg,
  iconColor,
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-6 backdrop-blur-sm transition-all hover:border-slate-600/50">
      <div className="mb-4 flex items-center justify-between">
        <div className={`rounded-lg p-3 ${iconBg}`}>
          <div className={iconColor}>{icon}</div>
        </div>

        {change && (
          <div className={`flex items-center gap-1 text-sm ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
            {positive ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            {change}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-sm text-slate-400">{title}</p>
        <p className="font-mono text-slate-100">{value}</p>
        {subtext && <p className="mt-1 text-xs text-slate-500">{subtext}</p>}
      </div>
    </div>
  );
}

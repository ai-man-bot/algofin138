import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface DataPoint {
  date: string;
  value: number;
  timestamp?: number;
}

interface CustomAreaChartProps {
  data: DataPoint[];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDateLabel(timestamp?: number, fallbackDate?: string) {
  if (!timestamp) return fallbackDate ?? '';
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function CustomAreaChart({ data }: CustomAreaChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        No data available
      </div>
    );
  }

  const sortedData = [...data].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const values = sortedData.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.12, max * 0.0025, 25);

  return (
    <div className="h-full w-full px-4 pb-4 pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={sortedData} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
          <defs>
            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f7dff" stopOpacity={0.35} />
              <stop offset="75%" stopColor="#4f7dff" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#4f7dff" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#334155" strokeDasharray="4 6" opacity={0.25} vertical={false} />
          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
            tickFormatter={(value) => formatDateLabel(value)}
          />
          <YAxis
            domain={[Math.max(0, min - padding), max + padding]}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={82}
            tickFormatter={(value) => formatCompactCurrency(value)}
          />
          <Tooltip
            cursor={{ stroke: '#4f7dff', strokeOpacity: 0.4, strokeDasharray: '4 4' }}
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '10px',
              color: '#e2e8f0',
            }}
            formatter={(value: number) => [formatCurrency(value), 'Equity']}
            labelFormatter={(label: number) =>
              new Date(label).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#5b8cff"
            strokeWidth={2.5}
            fill="url(#equityGradient)"
            activeDot={{ r: 5, fill: '#5b8cff', stroke: '#0f172a', strokeWidth: 2 }}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

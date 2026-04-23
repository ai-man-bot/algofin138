interface DataPoint {
  date: string;
  value: number;
}

interface CustomAreaChartProps {
  data: DataPoint[];
}

export function CustomAreaChart({ data }: CustomAreaChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        No data available
      </div>
    );
  }

  const width = 100;
  const height = 100;
  const padding = { top: 10, right: 10, bottom: 20, left: 50 };
  
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  
  // Create path for the line
  const linePath = data.map((point, index) => {
    const x = padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
    const y = height - padding.bottom - ((point.value - min) / range) * (height - padding.top - padding.bottom);
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  
  // Create path for the filled area
  const areaPath = linePath + 
    ` L ${padding.left + (width - padding.left - padding.right)} ${height - padding.bottom}` +
    ` L ${padding.left} ${height - padding.bottom} Z`;
  
  // Calculate Y axis ticks
  const yTicks = [min, (min + max) / 2, max];
  
  return (
    <div className="h-full w-full m-[0px] p-[0px] bg-[rgba(10,251,134,0)] rounded-[5px]">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        
        {/* Grid lines */}
        {yTicks.map((tick, i) => {
          const y = height - padding.bottom - ((tick - min) / range) * (height - padding.top - padding.bottom);
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#334155"
                strokeWidth="0.5"
                strokeDasharray="3 3"
                opacity="0.2"
              />
            </g>
          );
        })}
        
        {/* Y axis labels */}
        {yTicks.map((tick, i) => {
          const y = height - padding.bottom - ((tick - min) / range) * (height - padding.top - padding.bottom);
          return (
            <text
              key={i}
              x={padding.left - 5}
              y={y}
              fill="#64748b"
              fontSize="3"
              textAnchor="end"
              dominantBaseline="middle"
            >
              ${(tick / 1000).toFixed(0)}k
            </text>
          );
        })}
        
        {/* X axis labels */}
        {data.map((point, index) => {
          if (index % Math.ceil(data.length / 5) !== 0 && index !== data.length - 1) return null;
          const x = padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
          return (
            <text
              key={index}
              x={x}
              y={height - padding.bottom + 5}
              fill="#64748b"
              fontSize="3"
              textAnchor="middle"
            >
              {point.date}
            </text>
          );
        })}
        
        {/* Area fill */}
        <path
          d={areaPath}
          fill="url(#areaGradient)"
        />
        
        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="0.5"
        />
        
        {/* Data points */}
        {data.map((point, index) => {
          const x = padding.left + (index / (data.length - 1)) * (width - padding.left - padding.right);
          const y = height - padding.bottom - ((point.value - min) / range) * (height - padding.top - padding.bottom);
          return (
            <g key={index}>
              <circle
                cx={x}
                cy={y}
                r="1"
                fill="#3b82f6"
              />
              <title>{point.date}: ${point.value.toLocaleString()}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
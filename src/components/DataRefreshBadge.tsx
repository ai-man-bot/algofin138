interface DataRefreshBadgeProps {
  isLoading?: boolean;
  isRefreshing?: boolean;
  updatedAt?: number | null;
  lastDurationMs?: number | null;
  className?: string;
}

function formatAge(updatedAt: number) {
  const elapsedMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function DataRefreshBadge({
  isLoading = false,
  isRefreshing = false,
  updatedAt,
  lastDurationMs,
  className = '',
}: DataRefreshBadgeProps) {
  const isSlow = typeof lastDurationMs === 'number' && lastDurationMs >= 1000;

  let label = 'No cached data';
  if (isLoading) {
    label = 'Loading data';
  } else if (isRefreshing) {
    label = updatedAt ? `Refreshing, showing ${formatAge(updatedAt)}` : 'Refreshing';
  } else if (updatedAt) {
    label = `Updated ${formatAge(updatedAt)}`;
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/70 px-3 py-1 text-xs text-slate-400 ${className}`.trim()}
    >
      <span className={`h-2 w-2 rounded-full ${isLoading || isRefreshing ? 'bg-blue-400' : 'bg-emerald-400'}`} />
      <span>{label}</span>
      {isSlow && <span className="text-amber-400">Slow {Math.round(lastDurationMs)}ms</span>}
    </div>
  );
}

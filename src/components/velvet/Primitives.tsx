import type { CSSProperties, ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'pos' | 'neg' | 'warn';

const toneMap: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--af-surface-2)', fg: 'var(--af-ink-2)' },
  primary: { bg: 'var(--af-primary-soft)', fg: 'var(--af-primary-ink)' },
  pos: { bg: 'var(--af-pos-soft)', fg: 'var(--af-pos)' },
  neg: { bg: 'var(--af-neg-soft)', fg: 'var(--af-neg)' },
  warn: { bg: 'var(--af-warn-soft)', fg: 'var(--af-warn)' },
};

export function formatUSD(value: unknown, opts: { sign?: boolean; compact?: boolean; decimals?: number } = {}) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : 0;
  const { sign = false, compact = false, decimals = 2 } = opts;
  const abs = Math.abs(safe);

  if (compact && abs >= 1000) {
    const suffix = abs >= 1_000_000 ? 'M' : 'k';
    const divisor = abs >= 1_000_000 ? 1_000_000 : 1000;
    return `${sign && safe > 0 ? '+' : safe < 0 ? '-' : ''}$${(abs / divisor).toFixed(1)}${suffix}`;
  }

  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign && safe > 0 ? '+' : safe < 0 ? '-' : ''}$${formatted}`;
}

export function formatPct(value: unknown, opts: { sign?: boolean; decimals?: number } = {}) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : 0;
  const { sign = true, decimals = 2 } = opts;
  const prefix = sign && safe > 0 ? '+' : safe < 0 ? '-' : '';
  return `${prefix}${Math.abs(safe).toFixed(decimals)}%`;
}

export function Card({
  children,
  className = '',
  pad = 'md',
  style,
}: {
  children: ReactNode;
  className?: string;
  pad?: 'none' | 'sm' | 'md' | 'lg';
  style?: CSSProperties;
}) {
  const padding = pad === 'none' ? '' : pad === 'sm' ? 'p-3' : pad === 'lg' ? 'p-5' : 'p-3';
  return (
    <section className={`af-card ${padding} ${className}`} style={style}>
      {children}
    </section>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  dot = false,
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const colors = toneMap[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'} ${className}`}
      style={{ background: colors.bg, color: colors.fg }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.fg }} />}
      {children}
    </span>
  );
}

export function Button({
  children,
  tone = 'ghost',
  size = 'md',
  icon,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'ghost' | 'flat' | 'soft' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-transparent bg-[var(--af-primary)] text-white hover:brightness-95'
      : tone === 'soft'
        ? 'border-transparent bg-[var(--af-primary-soft)] text-[var(--af-primary-ink)] hover:brightness-95'
        : tone === 'danger'
          ? 'border-[var(--af-line)] bg-[var(--af-neg-soft)] text-[var(--af-neg)] hover:brightness-95'
          : tone === 'flat'
            ? 'border-transparent bg-transparent text-[var(--af-ink-2)] hover:bg-[var(--af-surface-2)]'
            : 'border-[var(--af-line)] bg-[var(--af-surface)] text-[var(--af-ink-2)] hover:bg-[var(--af-surface-2)]';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'} ${toneClass} ${className}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  items,
  active,
  onChange,
}: {
  items: T[];
  active: T;
  onChange: (item: T) => void;
}) {
  return (
    <div className="inline-flex rounded-[9px] bg-[var(--af-surface-2)] p-0.5">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            active === item
              ? 'bg-[var(--af-surface)] text-[var(--af-ink)] shadow-[0_1px_2px_rgba(15,16,20,.06)]'
              : 'text-[var(--af-muted)] hover:text-[var(--af-ink)]'
          }`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-4">
      <div>
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--af-ink)]">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-[var(--af-muted)]">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  delta,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const valueColor = tone === 'pos' ? 'text-[var(--af-pos)]' : tone === 'neg' ? 'text-[var(--af-neg)]' : 'text-[var(--af-ink)]';
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-[var(--af-muted)]">{label}</span>
        {delta != null && <Pill tone={delta >= 0 ? 'pos' : 'neg'} size="sm">{formatPct(delta)}</Pill>}
      </div>
      <div className={`af-num mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.02em] ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[var(--af-faint)]">{sub}</div>}
    </Card>
  );
}

export function BrokerToggle({
  active,
  onChange,
  brokers,
}: {
  active: string;
  onChange: (id: string) => void;
  brokers: { id: string; label: string; color?: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-[9px] bg-[var(--af-surface-2)] p-0.5">
      {brokers.map((broker) => {
        const selected = active === broker.id;
        return (
          <button
            key={broker.id}
            type="button"
            onClick={() => onChange(broker.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
              selected ? 'bg-[var(--af-surface)] text-[var(--af-ink)] shadow-[0_1px_2px_rgba(15,16,20,.06)]' : 'text-[var(--af-muted)] hover:text-[var(--af-ink)]'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: broker.color || 'var(--af-primary)' }} />
            {broker.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-5 text-center text-sm text-[var(--af-muted)]">{children}</div>;
}

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Pill } from './velvet/Primitives';
import { VelvetIcons } from './velvet/icons';

type AppScreen =
  | 'dashboard'
  | 'trades'
  | 'brokers'
  | 'strategy'
  | 'strategy-lab'
  | 'webhooks'
  | 'notifications'
  | 'account'
  | 'webhook-debug'
  | 'analytics'
  | 'performance'
  | 'operations';

const COLLAPSE_KEY = 'algofin.velvet.sidebar.collapsed';

const primaryNav: { id: AppScreen; label: string; icon: ReactNode; badge?: string; count?: number }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: VelvetIcons.dashboard },
  { id: 'strategy', label: 'Strategies', icon: VelvetIcons.strategies },
  { id: 'trades', label: 'Trades', icon: VelvetIcons.trades },
  { id: 'strategy-lab', label: 'StrategyLab', icon: VelvetIcons.lab, badge: 'BETA' },
  { id: 'webhooks', label: 'Webhooks', icon: VelvetIcons.webhooks },
  { id: 'brokers', label: 'Brokers', icon: VelvetIcons.brokers },
  { id: 'notifications', label: 'Notifications', icon: VelvetIcons.bell, count: 3 },
];

const utilityNav: { id: AppScreen; label: string; icon: ReactNode }[] = [
  { id: 'analytics', label: 'Analytics', icon: VelvetIcons.activity },
  { id: 'performance', label: 'Performance', icon: VelvetIcons.operations },
  { id: 'operations', label: 'Operations', icon: VelvetIcons.shield },
  { id: 'webhook-debug', label: 'Webhook Debug', icon: VelvetIcons.settings },
  { id: 'account', label: 'Account', icon: VelvetIcons.user },
];

export function AppShell({
  currentScreen,
  onNavigate,
  userName,
  userEmail,
  children,
}: {
  currentScreen: AppScreen;
  onNavigate: (screen: AppScreen) => void;
  userName: string;
  userEmail: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage may be unavailable in private contexts.
    }
  }, [collapsed]);

  const navLabel = useMemo(
    () => [...primaryNav, ...utilityNav].find((item) => item.id === currentScreen)?.label || 'Dashboard',
    [currentScreen],
  );
  const [clockTime, setClockTime] = useState(() =>
    new Date().toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'America/New_York',
    })
  );
  useEffect(() => {
    const id = setInterval(() => {
      setClockTime(new Date().toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', second: '2-digit',
        hour12: true, timeZone: 'America/New_York',
      }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const renderNavButton = (item: { id: AppScreen; label: string; icon: ReactNode; badge?: string; count?: number }) => {
    const active = currentScreen === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onNavigate(item.id)}
        title={collapsed ? item.label : undefined}
        aria-current={active ? 'page' : undefined}
        className={`relative flex w-full items-center gap-2.5 rounded-lg text-left text-[13px] font-medium transition ${
          collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
        } ${
          active
            ? 'bg-[var(--af-primary-soft)] text-[var(--af-primary-ink)]'
            : 'text-[var(--af-ink-2)] hover:bg-[var(--af-surface-2)]'
        }`}
      >
        <span className={active ? 'text-[var(--af-primary)]' : 'text-[var(--af-faint)]'}>{item.icon}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {!collapsed && item.badge && <span className="rounded bg-[var(--af-primary)] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">{item.badge}</span>}
        {!collapsed && item.count && <span className="rounded-full bg-[var(--af-neg)] px-1.5 py-0.5 text-[10px] font-semibold text-white">{item.count}</span>}
        {collapsed && item.count && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--af-neg)]" />}
      </button>
    );
  };

  return (
    <div className="af-app-shell" style={{ gridTemplateColumns: collapsed ? '64px minmax(0,1fr)' : '224px minmax(0,1fr)' }}>
      <aside className={`af-sidebar ${collapsed ? 'px-2' : 'px-3.5'}`}>
        <div className="flex items-center justify-between gap-2 px-1 py-4">
          <button type="button" onClick={() => onNavigate('dashboard')} className="flex min-w-0 items-center gap-2 text-left">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--af-primary)] text-sm font-bold text-white">a</span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold tracking-[-0.02em] text-[var(--af-ink)]">AlgoFin</span>
                <span className="-mt-0.5 block whitespace-nowrap text-[10px] text-[var(--af-muted)]">Quant trading</span>
              </span>
            )}
          </button>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="grid h-7 w-7 place-items-center rounded-md text-[var(--af-muted)] hover:bg-[var(--af-surface-2)]"
              title="Collapse sidebar"
            >
              {VelvetIcons.menu}
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mb-3 grid h-8 w-full place-items-center rounded-lg text-[var(--af-muted)] hover:bg-[var(--af-surface-2)]"
            title="Expand sidebar"
          >
            {VelvetIcons.menu}
          </button>
        )}

        {!collapsed && (
          <button className="mb-3 flex w-full items-center gap-2 rounded-[9px] border border-[var(--af-line)] bg-[var(--af-surface-2)] px-2.5 py-2 text-left">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--af-primary-soft)] text-[11px] font-bold text-[var(--af-primary-ink)]">A</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-[var(--af-ink)]">Alpaca Paper</span>
              <span className="af-mono block text-[10px] text-[var(--af-muted)]">PA3A82Y1AMF0</span>
            </span>
            {VelvetIcons.chevron}
          </button>
        )}

        <nav className="flex flex-1 flex-col gap-0.5">
          {primaryNav.map(renderNavButton)}
          <div className="my-2 border-t border-[var(--af-line)]" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              className={`flex w-full items-center gap-2.5 rounded-lg text-[13px] font-medium text-[var(--af-ink-2)] hover:bg-[var(--af-surface-2)] ${collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'}`}
              title={collapsed ? 'More' : undefined}
            >
              <span className="text-[var(--af-faint)]">{VelvetIcons.more}</span>
              {!collapsed && <span className="flex-1 text-left">More</span>}
              {!collapsed && VelvetIcons.chevron}
            </button>
            {moreOpen && (
              <div className={collapsed ? 'absolute left-full top-0 z-30 ml-2 w-48 rounded-xl border border-[var(--af-line)] bg-[var(--af-surface)] p-1.5 shadow-[var(--af-shadow-pop)]' : 'mt-1 space-y-0.5'}>
                {utilityNav.map(renderNavButton)}
              </div>
            )}
          </div>
        </nav>

        <button
          type="button"
          onClick={() => onNavigate('account')}
          className={`mt-3 flex items-center gap-2 border-t border-[var(--af-line)] pt-3 text-left ${collapsed ? 'justify-center' : ''}`}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,oklch(0.75_0.12_270),oklch(0.55_0.18_270))] text-xs font-bold text-white">
            {(userName || userEmail || 'A')[0]?.toUpperCase()}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-[var(--af-ink)]">{userName || 'User'}</span>
              <span className="block truncate text-[10px] text-[var(--af-muted)]">{userEmail}</span>
            </span>
          )}
        </button>
      </aside>

      <main className="flex min-w-0 flex-col">
        <header className="af-topbar">
          <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--af-muted)]">
            <span>AlgoFin</span>
            <span>/</span>
            <span className="truncate text-[13px] font-medium text-[var(--af-ink)]">{navLabel}</span>
          </div>
          <div className="hidden max-w-[380px] flex-1 items-center gap-2 rounded-lg bg-[var(--af-surface-2)] px-3 py-1.5 text-xs text-[var(--af-muted)] md:flex">
            {VelvetIcons.search}
            <span className="truncate">Search symbols, strategies...</span>
            <span className="af-mono ml-auto rounded border border-[var(--af-line)] bg-[var(--af-surface)] px-1.5 py-0.5 text-[10px]">Ctrl K</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Pill tone="pos" dot>Market open</Pill>
              <span className="af-mono hidden text-xs text-[var(--af-muted)] md:inline">{clockTime} ET</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="relative grid h-8 w-8 place-items-center rounded-lg border border-[var(--af-line)] text-[var(--af-ink-2)] hover:bg-[var(--af-surface-2)]"
              title="Notifications"
            >
              {VelvetIcons.bell}
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-[var(--af-surface)] bg-[var(--af-neg)]" />
            </button>
          </div>
        </header>
        <div className="min-w-0 flex-1 overflow-auto p-3 md:p-4">{children}</div>
      </main>
    </div>
  );
}

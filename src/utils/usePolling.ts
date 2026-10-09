import { useEffect, useRef } from 'react';

type PollingCallback = () => void | Promise<unknown>;

/**
 * Runs `callback` on an interval while `enabled` is true and the browser
 * tab is visible. Used to keep live data (quotes, prices, notifications)
 * fresh without burning API quota from hidden screens or background tabs.
 *
 * - The callback is invoked through a ref, so it always sees the latest
 *   state without being listed as a dependency.
 * - Ticks are skipped while the document is hidden; polling resumes on
 *   the next tick once the tab becomes visible again.
 * - When `immediate` is true, the callback also fires once each time
 *   `enabled` turns true.
 */
export function usePolling(callback: PollingCallback, intervalMs: number, enabled = true, immediate = false) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    if (immediate && !document.hidden) {
      void callbackRef.current();
    }

    const id = setInterval(() => {
      if (document.hidden) return;
      void callbackRef.current();
    }, intervalMs);

    return () => clearInterval(id);
  }, [enabled, intervalMs, immediate]);
}

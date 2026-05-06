type CacheEntry<T> = {
  data?: T;
  updatedAt: number;
  inflight?: Promise<T>;
  error?: Error | null;
  startedAt?: number;
};

export type CacheSnapshot<T> = {
  data?: T;
  updatedAt: number;
  inflight: boolean;
};

type LoadOptions = {
  ttlMs?: number;
  forceRefresh?: boolean;
};

export type RequestCacheStatus = {
  key: string;
  state: 'idle' | 'refreshing' | 'ready' | 'error';
  updatedAt: number | null;
  startedAt: number | null;
  error: Error | null;
};

type StatusListener = (status: RequestCacheStatus) => void;

export function createRequestCache(now: () => number = () => Date.now()) {
  const entries = new Map<string, CacheEntry<unknown>>();
  const listeners = new Map<string, Set<StatusListener>>();

  function getStatus(key: string): RequestCacheStatus {
    const entry = entries.get(key);

    if (!entry) {
      return {
        key,
        state: 'idle',
        updatedAt: null,
        startedAt: null,
        error: null,
      };
    }

    if (entry.inflight) {
      return {
        key,
        state: 'refreshing',
        updatedAt: entry.updatedAt || null,
        startedAt: entry.startedAt || null,
        error: null,
      };
    }

    if (entry.error) {
      return {
        key,
        state: 'error',
        updatedAt: entry.updatedAt || null,
        startedAt: entry.startedAt || null,
        error: entry.error,
      };
    }

    return {
      key,
      state: entry.data === undefined ? 'idle' : 'ready',
      updatedAt: entry.updatedAt || null,
      startedAt: entry.startedAt || null,
      error: null,
    };
  }

  function notify(key: string) {
    const status = getStatus(key);
    listeners.get(key)?.forEach((listener) => listener(status));
  }

  async function refresh<T>(key: string, fetcher: () => Promise<T>) {
    const existing = entries.get(key) as CacheEntry<T> | undefined;
    if (existing?.inflight) {
      return existing.inflight;
    }

    const startedAt = now();
    const inflight = Promise.resolve(fetcher())
      .then((data) => {
        entries.set(key, {
          data,
          updatedAt: now(),
          error: null,
          startedAt,
        });
        notify(key);
        return data;
      })
      .catch((error) => {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const latest = entries.get(key) as CacheEntry<T> | undefined;
        if (latest?.data !== undefined) {
          entries.set(key, {
            data: latest.data,
            updatedAt: latest.updatedAt,
            error: normalizedError,
            startedAt,
          });
        } else {
          entries.set(key, {
            updatedAt: 0,
            error: normalizedError,
            startedAt,
          });
        }
        notify(key);
        throw error;
      });

    entries.set(key, {
      data: existing?.data,
      updatedAt: existing?.updatedAt ?? 0,
      error: null,
      startedAt,
      inflight,
    });
    notify(key);

    return inflight;
  }

  return {
    peek<T>(key: string) {
      return entries.get(key)?.data as T | undefined;
    },

    peekSnapshot<T>(key: string): CacheSnapshot<T> | undefined {
      const entry = entries.get(key) as CacheEntry<T> | undefined;

      if (!entry) {
        return undefined;
      }

      return {
        data: entry.data,
        updatedAt: entry.updatedAt,
        inflight: Boolean(entry.inflight),
      };
    },

    clear() {
      entries.clear();
      for (const key of listeners.keys()) {
        notify(key);
      }
    },

    invalidate(prefix: string) {
      const invalidatedKeys: string[] = [];
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
          invalidatedKeys.push(key);
        }
      }
      invalidatedKeys.forEach(notify);
    },

    getStatus,

    subscribe(key: string, listener: StatusListener) {
      const keyListeners = listeners.get(key) ?? new Set<StatusListener>();
      keyListeners.add(listener);
      listeners.set(key, keyListeners);
      listener(getStatus(key));

      return () => {
        keyListeners.delete(listener);
        if (keyListeners.size === 0) {
          listeners.delete(key);
        }
      };
    },

    async load<T>(key: string, fetcher: () => Promise<T>, options: LoadOptions = {}) {
      const ttlMs = options.ttlMs ?? 15_000;
      const existing = entries.get(key) as CacheEntry<T> | undefined;

      if (options.forceRefresh) {
        return refresh(key, fetcher);
      }

      if (existing?.data !== undefined) {
        const age = now() - existing.updatedAt;
        if (age < ttlMs) {
          return existing.data;
        }

        void refresh(key, fetcher);
        return existing.data;
      }

      return refresh(key, fetcher);
    },
  };
}

export const requestCache = createRequestCache();

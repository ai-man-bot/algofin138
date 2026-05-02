type CacheEntry<T> = {
  data?: T;
  updatedAt: number;
  inflight?: Promise<T>;
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

export function createRequestCache(now: () => number = () => Date.now()) {
  const entries = new Map<string, CacheEntry<unknown>>();

  async function refresh<T>(key: string, fetcher: () => Promise<T>) {
    const existing = entries.get(key) as CacheEntry<T> | undefined;
    if (existing?.inflight) {
      return existing.inflight;
    }

    const inflight = fetcher()
      .then((data) => {
        entries.set(key, {
          data,
          updatedAt: now(),
        });
        return data;
      })
      .catch((error) => {
        const latest = entries.get(key) as CacheEntry<T> | undefined;
        if (latest?.data !== undefined) {
          entries.set(key, {
            data: latest.data,
            updatedAt: latest.updatedAt,
          });
        } else {
          entries.delete(key);
        }
        throw error;
      });

    entries.set(key, {
      data: existing?.data,
      updatedAt: existing?.updatedAt ?? 0,
      inflight,
    });

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
    },

    invalidate(prefix: string) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
        }
      }
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

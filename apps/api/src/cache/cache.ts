/** The few commands the cache needs, so tests and Redis can both provide them. */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  setWithExpiry(key: string, value: string, seconds: number): Promise<void>;
  increment(key: string): Promise<void>;
}

export interface ReadCache {
  /** Returns the saved answer, or loads it and saves it. A failing store only means a slower read. */
  read<T>(key: string, load: () => Promise<T>): Promise<T>;
  /** Makes every saved answer stale. Call it after any write has committed. */
  invalidate(): Promise<void>;
}

export const VERSION_KEY = "tna:version";

/**
 * Only a safety net. Writes invalidate at once, so this limits how long an answer can
 * outlive a change made outside the app, or a write made while Redis could not be reached.
 */
const MAX_AGE_SECONDS = 300;

/**
 * Every key carries a version number, and any write moves the version on, so a write makes all
 * saved answers unreachable in one step. A read already running when a write lands saves under
 * the old version, so it can never bring back data from before the write.
 */
export function createReadCache(store: CacheStore | null, warn: (message: string) => void = console.warn): ReadCache {
  /** Two identical requests at once share one trip to the database. */
  const loading = new Map<string, Promise<unknown>>();

  function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = loading.get(key);
    if (running) return running as Promise<T>;
    const started = load().finally(() => loading.delete(key));
    loading.set(key, started);
    return started;
  }

  return {
    async read(key, load) {
      if (!store) return load();

      let fullKey: string;
      try {
        const version = (await store.get(VERSION_KEY)) ?? "0";
        fullKey = `tna:v${version}:${key}`;
        const saved = await store.get(fullKey);
        if (saved !== null) return JSON.parse(saved);
      } catch {
        return load();
      }

      return shared(fullKey, async () => {
        const value = await load();
        await store.setWithExpiry(fullKey, JSON.stringify(value), MAX_AGE_SECONDS).catch(() => undefined);
        return value;
      });
    },

    async invalidate() {
      if (!store) return;
      try {
        await store.increment(VERSION_KEY);
      } catch {
        warn(`Could not clear the cache after a write. Saved answers can be up to ${MAX_AGE_SECONDS} seconds old`);
      }
    },
  };
}

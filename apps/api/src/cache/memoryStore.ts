import type { CacheStore } from "./cache.js";

/** For tests: behaves like the Redis store, and counts reads so a test can see a cache hit. */
export function createMemoryStore(): CacheStore & { keys(): string[]; fail: boolean } {
  const values = new Map<string, string>();
  const store = {
    fail: false,
    keys: () => [...values.keys()],
    async get(key: string) {
      if (store.fail) throw new Error("store is down");
      return values.get(key) ?? null;
    },
    async setWithExpiry(key: string, value: string) {
      if (store.fail) throw new Error("store is down");
      values.set(key, value);
    },
    async increment(key: string) {
      if (store.fail) throw new Error("store is down");
      values.set(key, String(Number(values.get(key) ?? 0) + 1));
    },
  };
  return store;
}

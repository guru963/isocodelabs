import { Redis } from "ioredis";
import { VERSION_KEY, type CacheStore } from "./cache.js";

export interface RedisStore extends CacheStore {
  close(): Promise<void>;
}

/** For scripts that change data outside the running app, such as the seed. Never throws. */
export async function clearCacheOnce(url: string): Promise<void> {
  const client = new Redis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1, retryStrategy: () => null });
  client.on("error", () => undefined);
  try {
    await client.connect();
    await client.incr(VERSION_KEY);
  } catch {
    console.warn("Could not clear the cache. Saved answers can be up to 5 minutes old");
  } finally {
    client.disconnect();
  }
}

/** A cache must never be slower than the database it saves a trip to. */
const COMMAND_TIMEOUT_MS = 500;

export function createRedisStore(url: string, log: (message: string) => void = console.warn): RedisStore {
  let reported = false;

  const client = new Redis(url, {
    connectTimeout: 2000,
    commandTimeout: COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    // Commands fail straight away while disconnected, so requests fall through to the database.
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });

  client.on("error", (error: Error) => {
    if (reported) return;
    reported = true;
    log(`Redis is unavailable, so requests are going straight to the database: ${error.message}`);
  });
  client.on("ready", () => {
    if (reported) log("Redis is reachable again");
    reported = false;
  });

  return {
    get: (key) => client.get(key),
    async setWithExpiry(key, value, seconds) {
      await client.set(key, value, "EX", seconds);
    },
    async increment(key) {
      await client.incr(key);
    },
    async close() {
      client.disconnect();
    },
  };
}

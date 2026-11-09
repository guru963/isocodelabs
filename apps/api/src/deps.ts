import type { PrismaClient } from "@prisma/client";
import type { AiQueue } from "./ai/queue.js";
import type { ReadCache } from "./cache/cache.js";
import type { Clock } from "./lib/dates.js";
import type { Storage } from "./uploads/storage.js";

/** Everything the app needs from outside. Tests pass fakes for the clock, AI and storage. */
export interface AppDeps {
  prisma: PrismaClient;
  today: Clock;
  jwtSecret: string;
  secureCookies: boolean;
  storage: Storage;
  aiQueue: AiQueue;
  cache: ReadCache;
  loginAttemptsPerWindow?: number;
  /**
   * The work a long-running server does on timers, for hosts without them. When set, a
   * scheduler calls /api/tasks/run with this secret as a bearer token.
   */
  tasks?: { secret: string; run(): Promise<Record<string, number>> };
}

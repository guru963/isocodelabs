import type { PrismaClient } from "@prisma/client";
import type { AiQueue } from "./ai/queue.js";
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
  loginAttemptsPerWindow?: number;
}

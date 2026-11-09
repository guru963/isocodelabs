import { PrismaClient } from "@prisma/client";
import { createAiQueue, type AiQueue } from "./ai/queue.js";
import { createGroqClassifier } from "./ai/groqClassifier.js";
import { createApp } from "./app.js";
import { createReadCache } from "./cache/cache.js";
import { createRedisStore } from "./cache/redisStore.js";
import type { Config } from "./config.js";
import { createClock } from "./lib/dates.js";
import { createNotifier } from "./notifications/notifier.js";
import { parseTime } from "./notifications/rules.js";
import { createBlobStorage, createDiskStorage } from "./uploads/storage.js";

export interface Runtime {
  app: ReturnType<typeof createApp>;
  prisma: PrismaClient;
  aiQueue: AiQueue;
  notifier: ReturnType<typeof createNotifier>;
  close(): Promise<void>;
}

/**
 * Builds the app and the work around it from settings. A long-running server then starts the
 * timers itself; a serverless host leaves them off and has a scheduler call /api/tasks/run.
 */
export function createRuntime(config: Config, keepAlive?: (work: Promise<unknown>) => void): Runtime {
  const prisma = new PrismaClient();

  const classifier = config.GROQ_API_KEY ? createGroqClassifier(config.GROQ_API_KEY, config.AI_MODEL) : null;
  if (!classifier) console.warn("GROQ_API_KEY is not set: notes will go straight to human review");

  const redis = config.REDIS_URL ? createRedisStore(config.REDIS_URL) : null;
  if (!redis) console.warn("REDIS_URL is not set: every request will go to the database");
  const cache = createReadCache(redis);

  const aiQueue = createAiQueue(prisma, classifier, cache.invalidate, keepAlive);
  const today = createClock(config.APP_TODAY);
  const notifier = createNotifier(prisma, {
    today,
    reminderAt: parseTime(config.REMINDER_TIME),
    escalateAt: parseTime(config.ESCALATION_TIME),
  });

  const storage =
    config.BLOB_STORE_ID || config.BLOB_READ_WRITE_TOKEN
      ? createBlobStorage(config.BLOB_READ_WRITE_TOKEN)
      : createDiskStorage(config.UPLOAD_DIR);

  const app = createApp(
    {
      prisma,
      today,
      jwtSecret: config.JWT_SECRET,
      secureCookies: config.NODE_ENV === "production",
      storage,
      aiQueue,
      cache,
      tasks: config.CRON_SECRET
        ? {
            secret: config.CRON_SECRET,
            // The same sweeps the server runs on timers: notes still waiting for the AI, then reminders.
            async run() {
              await aiQueue.sweep();
              const { created } = await notifier.run();
              await aiQueue.idle();
              return { notificationsCreated: created };
            },
          }
        : undefined,
    },
    config.UPLOAD_DIR,
  );

  return {
    app,
    prisma,
    aiQueue,
    notifier,
    async close() {
      await aiQueue.idle();
      await prisma.$disconnect();
      await redis?.close();
    },
  };
}

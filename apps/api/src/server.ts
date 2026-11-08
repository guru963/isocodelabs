import { PrismaClient } from "@prisma/client";
import { createAiQueue } from "./ai/queue.js";
import { createGroqClassifier } from "./ai/groqClassifier.js";
import { createApp } from "./app.js";
import { createReadCache } from "./cache/cache.js";
import { createRedisStore } from "./cache/redisStore.js";
import { loadConfig } from "./config.js";
import { createClock } from "./lib/dates.js";
import { createNotifier } from "./notifications/notifier.js";
import { parseTime } from "./notifications/rules.js";
import { createDiskStorage } from "./uploads/storage.js";

const config = loadConfig();
const prisma = new PrismaClient();

const classifier = config.GROQ_API_KEY ? createGroqClassifier(config.GROQ_API_KEY, config.AI_MODEL) : null;
if (!classifier) console.warn("GROQ_API_KEY is not set: notes will go straight to human review");

const redis = config.REDIS_URL ? createRedisStore(config.REDIS_URL) : null;
if (!redis) console.warn("REDIS_URL is not set: every request will go to the database");
const cache = createReadCache(redis);

const aiQueue = createAiQueue(prisma, classifier, cache.invalidate);

const app = createApp(
  {
    prisma,
    today: createClock(config.APP_TODAY),
    jwtSecret: config.JWT_SECRET,
    secureCookies: config.NODE_ENV === "production",
    storage: createDiskStorage(config.UPLOAD_DIR),
    aiQueue,
    cache,
  },
  config.UPLOAD_DIR,
);

const notifier = createNotifier(prisma, {
  today: createClock(config.APP_TODAY),
  reminderAt: parseTime(config.REMINDER_TIME),
  escalateAt: parseTime(config.ESCALATION_TIME),
});

aiQueue.start();
notifier.start();
const server = app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});

async function shutdown() {
  aiQueue.stop();
  notifier.stop();
  server.close();
  await aiQueue.idle();
  await prisma.$disconnect();
  await redis?.close();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

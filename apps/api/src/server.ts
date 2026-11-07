import { PrismaClient } from "@prisma/client";
import { createAiQueue } from "./ai/queue.js";
import { createClaudeClassifier } from "./ai/claudeClassifier.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createClock } from "./lib/dates.js";
import { createDiskStorage } from "./uploads/storage.js";

const config = loadConfig();
const prisma = new PrismaClient();

const classifier = config.ANTHROPIC_API_KEY
  ? createClaudeClassifier(config.ANTHROPIC_API_KEY, config.AI_MODEL)
  : null;
if (!classifier) console.warn("ANTHROPIC_API_KEY is not set: notes will go straight to human review");

const aiQueue = createAiQueue(prisma, classifier);

const app = createApp(
  {
    prisma,
    today: createClock(config.APP_TODAY),
    jwtSecret: config.JWT_SECRET,
    secureCookies: config.NODE_ENV === "production",
    storage: createDiskStorage(config.UPLOAD_DIR),
    aiQueue,
  },
  config.UPLOAD_DIR,
);

aiQueue.start();
const server = app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});

async function shutdown() {
  aiQueue.stop();
  server.close();
  await aiQueue.idle();
  await prisma.$disconnect();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

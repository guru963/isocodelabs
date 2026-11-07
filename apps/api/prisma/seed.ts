import { PrismaClient } from "@prisma/client";
import { clearCacheOnce } from "../src/cache/redisStore.js";
import { seedDatabase } from "../src/seed/seedDatabase.js";

const prisma = new PrismaClient();

seedDatabase(prisma, process.env.SEED_DEMO_PASSWORD || "demo1234")
  .then(async (tokens) => {
    // Only hashes are stored, so this is the one chance to see each token.
    console.log("Seeded. Buyer link tokens, shown only now:");
    for (const [buyer, token] of Object.entries(tokens)) console.log(`  ${buyer}: ${token}`);
    if (process.env.REDIS_URL) await clearCacheOnce(process.env.REDIS_URL);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

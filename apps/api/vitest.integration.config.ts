import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://tna:tna_local_dev@localhost:5433/tna_test";

/** The full API against real Postgres, one file at a time because each test reseeds. */
export default defineConfig({
  test: {
    include: ["test/**/*.int.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});

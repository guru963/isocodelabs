import { defineConfig } from "vitest/config";

/** Fast tests with no database. */
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});

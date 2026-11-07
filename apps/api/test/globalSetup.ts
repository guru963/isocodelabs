import { execSync } from "node:child_process";

/** Brings the test database up to date. Prisma creates it if it does not exist. */
export function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://tna:tna_local_dev@localhost:5433/tna_test";
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}

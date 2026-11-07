import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient, type Stage } from "@prisma/client";
import request from "supertest";
import { createAiQueue } from "../src/ai/queue.js";
import type { NoteClassifier } from "../src/ai/classification.js";
import { createApp } from "../src/app.js";
import { createDiskStorage } from "../src/uploads/storage.js";
import { seedDatabase } from "../src/seed/seedDatabase.js";

export const prisma = new PrismaClient();
export const PASSWORD = "test-password";
export const TODAY = "2026-11-06";

export const PRIYA = "priya@companya.example";
export const MURUGAN = "murugan@companya.example";
export const SELVI = "selvi@companya.example";

export const seed = () => seedDatabase(prisma, PASSWORD);

/** A working app on the demo date. The classifier is a fake, so tests can make it fail. */
export function testApp(classifier: NoteClassifier | null = null, loginAttemptsPerWindow = 10_000) {
  const uploadDir = mkdtempSync(path.join(tmpdir(), "tna-test-"));
  const aiQueue = createAiQueue(prisma, classifier);
  const app = createApp(
    {
      prisma,
      today: () => TODAY,
      jwtSecret: "test-secret-that-is-long-enough-for-config",
      secureCookies: false,
      storage: createDiskStorage(uploadDir),
      aiQueue,
      loginAttemptsPerWindow,
    },
    uploadDir,
  );
  return { app, aiQueue };
}

export type TestApp = ReturnType<typeof testApp>["app"];

/** A client that keeps its session cookie, like a browser. */
export async function signIn(app: TestApp, email: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ email, password: PASSWORD });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${email}: ${response.status}`);
  return agent;
}

export const milestoneOf = (poNumber: string, stage: Stage) =>
  prisma.milestone.findFirstOrThrow({ where: { stage, order: { poNumber } } });

export const orderOf = (poNumber: string) => prisma.order.findUniqueOrThrow({ where: { poNumber } });

export const update = (milestoneId: string, fields: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  milestoneId,
  workDate: TODAY,
  qty: 100,
  capturedAt: `${TODAY}T12:30:00.000Z`,
  ...fields,
});

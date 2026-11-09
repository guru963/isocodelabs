import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AiQueue } from "./ai/queue.js";
import { createApp } from "./app.js";
import { createReadCache } from "./cache/cache.js";
import type { AppDeps } from "./deps.js";
import type { Storage } from "./uploads/storage.js";

const SECRET = "a-task-secret-long-enough";

const idleQueue: AiQueue = {
  schedule: () => undefined,
  sweep: async () => undefined,
  start: () => undefined,
  stop: () => undefined,
  idle: async () => undefined,
};

/** The app with no database behind it: these routes never touch one. */
function appWith(overrides: Partial<AppDeps>) {
  return createApp(
    {
      prisma: {} as PrismaClient,
      today: () => "2026-11-06",
      jwtSecret: "test-secret-that-is-long-enough-for-config",
      secureCookies: false,
      storage: { save: async () => "/files/unused.jpg", load: async () => null },
      aiQueue: idleQueue,
      cache: createReadCache(null),
      ...overrides,
    },
    "./unused-upload-dir",
  );
}

describe("scheduled tasks endpoint", () => {
  it("is closed without a secret, falling through to the signed-in routes", async () => {
    const res = await request(appWith({})).get("/api/tasks/run");
    expect(res.status).toBe(401);
    expect(res.body.status).toBeUndefined();
  });

  it("refuses a missing or wrong secret without running anything", async () => {
    const run = vi.fn(async () => ({ notificationsCreated: 0 }));
    const app = appWith({ tasks: { secret: SECRET, run } });
    expect((await request(app).get("/api/tasks/run")).status).toBe(401);
    expect((await request(app).get("/api/tasks/run").set("Authorization", "Bearer wrong")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the tasks for Vercel Cron's GET and a scheduler's POST", async () => {
    const run = vi.fn(async () => ({ notificationsCreated: 2 }));
    const app = appWith({ tasks: { secret: SECRET, run } });
    const viaGet = await request(app).get("/api/tasks/run").set("Authorization", `Bearer ${SECRET}`);
    expect(viaGet.status).toBe(200);
    expect(viaGet.body).toEqual({ status: "ok", notificationsCreated: 2 });
    const viaPost = await request(app).post("/api/tasks/run").set("Authorization", `Bearer ${SECRET}`);
    expect(viaPost.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("files served from storage", () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const NAME = "0f1e2d3c-4b5a-4968-8776-655443322110.jpg";

  const storage: Storage = {
    save: async () => `/files/${NAME}`,
    load: async () => null,
    read: async (name) =>
      name === NAME ? { stream: new Blob([photo]).stream(), contentType: "image/jpeg", size: photo.length } : null,
  };

  it("streams a stored file with its type", async () => {
    const res = await request(appWith({ storage })).get(`/files/${NAME}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.from(res.body as Buffer)).toEqual(photo);
  });

  it("answers 404 for a file it does not have", async () => {
    const res = await request(appWith({ storage })).get("/files/00000000-0000-4000-8000-000000000000.jpg");
    expect(res.status).toBe(404);
  });
});

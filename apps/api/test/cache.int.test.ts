import { beforeEach, describe, expect, it } from "vitest";
import { createReadCache } from "../src/cache/cache.js";
import { createMemoryStore } from "../src/cache/memoryStore.js";
import { MURUGAN, milestoneOf, orderOf, PRIYA, seed, signIn, testApp, TODAY, update } from "./helpers.js";

describe("cached screens", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let app: ReturnType<typeof testApp>["app"];

  beforeEach(async () => {
    await seed();
    store = createMemoryStore();
    ({ app } = testApp(null, 10_000, createReadCache(store)));
  });

  it("shows a supervisor's update on the board straight away", async () => {
    const priya = await signIn(app, PRIYA);
    const murugan = await signIn(app, MURUGAN);
    const stitching = await milestoneOf("B-PO-88213", "STITCHING");
    const order = await orderOf("B-PO-88213");

    const before = await priya.get(`/api/orders/${order.id}`);
    expect(store.keys()).toContain(`tna:v0:order:${TODAY}:${order.id}`);

    await murugan.post("/api/supervisor/updates/sync").send({
      updates: [update(stitching.id, { qty: 900 })],
    });

    const after = await priya.get(`/api/orders/${order.id}`);
    const done = (body: { milestones: { stage: string; doneQty: number }[] }) =>
      body.milestones.find((milestone) => milestone.stage === "STITCHING")?.doneQty;
    expect(done(after.body)).toBeGreaterThan(done(before.body) ?? 0);
  });

  it("shows a date change straight away", async () => {
    const priya = await signIn(app, PRIYA);
    const order = await orderOf("C-PO-0488");

    await priya.get(`/api/orders/${order.id}`);
    await priya.patch(`/api/orders/${order.id}/ex-factory`).send({ date: "2026-12-05", reason: "Buyer agreed" });

    const after = await priya.get(`/api/orders/${order.id}`);
    expect(after.body.exFactoryDate).toBe("2026-12-05");
  });

  it("removes a reviewed note from the queue straight away", async () => {
    const priya = await signIn(app, PRIYA);
    const { body } = await priya.get("/api/issues?status=PENDING");
    const [first] = body.issues;

    await priya.post(`/api/issues/${first.id}/review`).send({ action: "DISMISS" });

    const after = await priya.get("/api/issues?status=PENDING");
    expect(after.body.issues.map((issue: { id: string }) => issue.id)).not.toContain(first.id);
  });

  it("stops a revoked buyer link at once, even with its orders saved", async () => {
    const priya = await signIn(app, PRIYA);
    const order = await orderOf("B-PO-88213");
    const { body: link } = await priya.post(`/api/buyers/${order.buyerId}/links`).send({ expiresInDays: 30 });
    const request = (await import("supertest")).default;
    const asBuyer = () => request(app).get("/api/buyer/orders").set("x-buyer-token", link.token);

    expect((await asBuyer()).status).toBe(200);
    await priya.post(`/api/buyer-links/${link.id}/revoke`);

    expect((await asBuyer()).status).toBe(401);
  });
});

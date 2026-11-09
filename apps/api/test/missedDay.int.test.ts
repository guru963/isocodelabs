import { beforeEach, describe, expect, it } from "vitest";
import { createNotifier } from "../src/notifications/notifier.js";
import { milestoneOf, MURUGAN, orderOf, PRIYA, prisma, seed, signIn, testApp, TODAY, update } from "./helpers.js";

/** The working day before the demo Friday. */
const MISSED = "2026-11-05";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Removes Murugan's stitching count for the day before, so that day has a gap. */
async function makeGap() {
  const { id } = await milestoneOf("B-PO-88213", "STITCHING");
  await prisma.dailyUpdate.deleteMany({ where: { milestoneId: id, workDate: day(MISSED) } });
  return id;
}

const notifier = (now: Date) =>
  createNotifier(prisma, { today: () => TODAY, now: () => now, reminderAt: 17 * 60 + 30, escalateAt: 10 * 60, log: () => undefined });

describe("a missed day's count", () => {
  beforeEach(seed);

  it("is not asked for when every day has its count", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.get("/api/supervisor/worklist");
    expect(body.stages.map((stage: { missedDate: string | null }) => stage.missedDate)).toEqual(
      body.stages.map(() => null),
    );
  });

  it("is asked for on a stage that was under way, and not on one that had not started", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.get("/api/supervisor/worklist");

    const byId = new Map(body.stages.map((stage: { milestoneId: string }) => [stage.milestoneId, stage]));
    expect(byId.get(stitching)).toMatchObject({ missedDate: MISSED });
    const finishing = await milestoneOf("B-PO-88213", "FINISHING");
    expect(byId.get(finishing.id)).toMatchObject({ missedDate: null });
  });

  it("is never asked for on an order that did not exist yet", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const [buyer, unit, template] = await Promise.all([
      prisma.buyer.findFirstOrThrow(),
      prisma.unit.findFirstOrThrow({ where: { name: "Unit 1" } }),
      prisma.tnaTemplate.findFirstOrThrow({ where: { name: "Plain knit" } }),
    ]);
    const created = await merchandiser.post("/api/orders").send({
      poNumber: "B-PO-NEW",
      buyerId: buyer.id,
      style: "Henley",
      colour: "Grey",
      unitId: unit.id,
      templateId: template.id,
      exFactoryDate: "2026-12-15",
      sizes: [{ size: "M", qty: 500 }],
    });
    expect(created.status).toBe(201);

    // Real-world creation time is after the demo day, which is exactly the case: no history to ask about.
    const cutting = await prisma.milestone.findFirstOrThrow({ where: { orderId: created.body.id, stage: "CUTTING" } });
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.get("/api/supervisor/worklist");
    const stage = body.stages.find((item: { milestoneId: string }) => item.milestoneId === cutting.id);
    expect(stage).toMatchObject({ missedDate: null });
  });

  it("can be added the next day, is counted under its own day, and shows as late", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);

    const late = update(stitching, { workDate: MISSED, qty: 580, enteredOn: TODAY });
    const { body } = await supervisor.post("/api/supervisor/updates/sync").send({ updates: [late] });
    expect(body.results[0]).toMatchObject({ status: "ACCEPTED", doneQty: 7380 });

    const worklist = await supervisor.get("/api/supervisor/worklist");
    const stage = worklist.body.stages.find((item: { milestoneId: string }) => item.milestoneId === stitching);
    expect(stage.missedDate).toBeNull();

    const merchandiser = await signIn(app, PRIYA);
    const order = await orderOf("B-PO-88213");
    const detail = await merchandiser.get(`/api/orders/${order.id}`);
    const rows = detail.body.updates.filter((row: { stage: string }) => row.stage === "STITCHING");
    expect(rows.find((row: { workDate: string }) => row.workDate === MISSED)).toMatchObject({ qty: 580, enteredLate: true });
    expect(rows.find((row: { workDate: string }) => row.workDate === TODAY)).toMatchObject({ enteredLate: false });
  });

  it("cannot reach back further than the last working day", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor
      .post("/api/supervisor/updates/sync")
      .send({ updates: [update(stitching, { workDate: "2026-11-04", qty: 1, enteredOn: TODAY })] });
    expect(body.results[0]).toMatchObject({ status: "REJECTED", code: "TOO_LATE" });
  });

  it("still lets a phone that was offline deliver counts typed on their own days", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    // Typed on the 5th for the 5th, and only reaching the server now.
    const queued = update(stitching, { workDate: MISSED, qty: 590, enteredOn: MISSED, capturedAt: `${MISSED}T12:30:00.000Z` });
    const { body } = await supervisor.post("/api/supervisor/updates/sync").send({ updates: [queued] });
    expect(body.results[0]).toMatchObject({ status: "ACCEPTED" });
    const row = await prisma.dailyUpdate.findUniqueOrThrow({ where: { id: queued.id } });
    expect(row.enteredOn?.toISOString().slice(0, 10)).toBe(MISSED);
  });

  it("accepts updates from phones that do not send the day they were typed", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor
      .post("/api/supervisor/updates/sync")
      .send({ updates: [update(stitching, { workDate: MISSED, qty: 10 })] });
    expect(body.results[0]).toMatchObject({ status: "ACCEPTED" });
  });

  it("refuses a typed-on day in the future, or a work day after it", async () => {
    const stitching = await makeGap();
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.post("/api/supervisor/updates/sync").send({
      updates: [
        update(stitching, { workDate: MISSED, qty: 1, enteredOn: "2026-11-07" }),
        update(stitching, { workDate: TODAY, qty: 1, enteredOn: MISSED }),
      ],
    });
    expect(body.results.map((result: { code: string }) => result.code)).toEqual(["FUTURE_DATE", "FUTURE_DATE"]);
  });
});

describe("the morning reminder about a missed day", () => {
  beforeEach(seed);

  /** 10:30 am in India on the demo day, after the morning reminder time. */
  const LATE_MORNING = new Date(`${TODAY}T05:00:00Z`);
  /** 9 am in India, before it. */
  const EARLY = new Date(`${TODAY}T03:30:00Z`);

  it("tells the supervisor, in Tamil, once", async () => {
    await makeGap();
    await notifier(LATE_MORNING).run();
    await notifier(LATE_MORNING).run();

    const murugan = await prisma.user.findUniqueOrThrow({ where: { email: MURUGAN } });
    const reminders = await prisma.notification.findMany({
      where: { kind: "MISSED_YESTERDAY" },
      include: { messages: true },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ userId: murugan.id, link: "/floor" });
    expect(reminders[0]?.title).toContain("5 Nov");
    expect(reminders[0]?.body).toContain("B-PO-88213");
    expect(reminders[0]?.body).toMatch(/[஀-௿]/);
    expect(reminders[0]?.messages.map((message) => message.channel)).toEqual(["WHATSAPP"]);
  });

  it("waits until the morning reminder time", async () => {
    await makeGap();
    await notifier(EARLY).run();
    expect(await prisma.notification.count({ where: { kind: "MISSED_YESTERDAY" } })).toBe(0);
  });

  it("says nothing when the last working day has every count", async () => {
    await notifier(LATE_MORNING).run();
    expect(await prisma.notification.count({ where: { kind: "MISSED_YESTERDAY" } })).toBe(0);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { createNotifier } from "../src/notifications/notifier.js";
import { MURUGAN, PRIYA, prisma, seed, signIn, testApp, TODAY } from "./helpers.js";

/** 6 pm in India on the demo day, after the reminder time. */
const EVENING = new Date(`${TODAY}T12:30:00Z`);
/** 9 am in India, before every timed rule. */
const MORNING = new Date(`${TODAY}T03:30:00Z`);

const notifier = (now: Date, today = TODAY) =>
  createNotifier(prisma, { today: () => today, now: () => now, reminderAt: 17 * 60 + 30, escalateAt: 10 * 60, log: () => undefined });

describe("notifications", () => {
  beforeEach(seed);

  it("reminds a supervisor in the evening about stages with no count today, once", async () => {
    // Murugan's stitching was reported today in the seed, so remove that figure first.
    await prisma.dailyUpdate.deleteMany({ where: { workDate: new Date(`${TODAY}T00:00:00Z`), supervisor: { email: MURUGAN } } });

    await notifier(EVENING).run();
    await notifier(EVENING).run();

    const murugan = await prisma.user.findUniqueOrThrow({ where: { email: MURUGAN } });
    const reminders = await prisma.notification.findMany({ where: { userId: murugan.id, kind: "MISSED_COUNT" }, include: { messages: true } });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.body).toContain("B-PO-88213");
    expect(reminders[0]?.messages.map((message) => message.channel)).toEqual(["WHATSAPP"]);
  });

  it("does not remind anyone before the reminder time", async () => {
    await prisma.dailyUpdate.deleteMany({ where: { workDate: new Date(`${TODAY}T00:00:00Z`) } });
    await notifier(MORNING).run();
    expect(await prisma.notification.count({ where: { kind: "MISSED_COUNT" } })).toBe(0);
  });

  it("does not remind a supervisor whose stages all have today's count", async () => {
    await notifier(EVENING).run();
    const murugan = await prisma.user.findUniqueOrThrow({ where: { email: MURUGAN } });
    expect(await prisma.notification.count({ where: { userId: murugan.id, kind: "MISSED_COUNT" } })).toBe(0);
  });

  it("does not remind anyone on a holiday", async () => {
    await prisma.dailyUpdate.deleteMany({ where: { workDate: new Date(`${TODAY}T00:00:00Z`) } });
    await prisma.holiday.create({ data: { date: new Date(`${TODAY}T00:00:00Z`) } });
    await notifier(EVENING).run();
    expect(await prisma.notification.count({ where: { kind: "MISSED_COUNT" } })).toBe(0);
  });

  it("tells the merchandiser about an order that is red, once", async () => {
    await notifier(MORNING).run();
    await notifier(MORNING).run();
    const red = await prisma.notification.findMany({ where: { kind: "ORDER_RED" } });
    expect(red.map((item) => item.title)).toEqual(["B-PO-88213 is now delayed"]);
  });

  it("shows people only their own notifications, and marks them read", async () => {
    await notifier(MORNING).run();
    const { app } = testApp();
    const priya = await signIn(app, PRIYA);
    const murugan = await signIn(app, MURUGAN);

    const mine = await priya.get("/api/notifications");
    expect(mine.body.unread).toBeGreaterThan(0);
    expect((await murugan.get("/api/notifications")).body.notifications).toEqual([]);

    const [first] = mine.body.notifications;
    expect((await murugan.post(`/api/notifications/${first.id}/read`)).status).toBe(404);
    await priya.post(`/api/notifications/${first.id}/read`);
    const after = await priya.get("/api/notifications");
    expect(after.body.unread).toBe(mine.body.unread - 1);
  });
});

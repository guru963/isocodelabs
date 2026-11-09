import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ClassificationError } from "../src/ai/classification.js";
import {
  MURUGAN,
  milestoneOf,
  orderOf,
  PASSWORD,
  PRIYA,
  prisma,
  seed,
  SELVI,
  signIn,
  testApp,
  update,
} from "./helpers.js";

let tokens: Record<string, string>;

beforeEach(async () => {
  tokens = await seed();
});

afterAll(() => prisma.$disconnect());

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const machineNote = { translation: "2 machines broke", category: "MACHINE_BREAKDOWN", confidence: 0.92 } as const;

describe("sign-in and roles", () => {
  it("rejects a wrong password and an unknown email the same way", async () => {
    const { app } = testApp();
    const wrong = await request(app).post("/api/auth/login").send({ email: PRIYA, password: "nope" });
    const unknown = await request(app).post("/api/auth/login").send({ email: "x@y.example", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("sets an httpOnly session cookie", async () => {
    const { app } = testApp();
    const response = await request(app).post("/api/auth/login").send({ email: PRIYA, password: PASSWORD });
    expect(response.headers["set-cookie"]?.[0]).toMatch(/HttpOnly/);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("limits repeated sign-in attempts", async () => {
    const { app } = testApp(null, 2);
    const attempt = () => request(app).post("/api/auth/login").send({ email: PRIYA, password: "nope" });
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
  });

  it("requires sign-in for the board", async () => {
    const { app } = testApp();
    expect((await request(app).get("/api/orders/board")).status).toBe(401);
  });

  it("blocks a forged session", async () => {
    const { app } = testApp();
    const response = await request(app).get("/api/orders/board").set("Cookie", "session=not-a-real-token");
    expect(response.status).toBe(401);
  });

  it("keeps supervisors out of merchandiser endpoints", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    expect((await supervisor.get("/api/orders/board")).status).toBe(403);
    expect((await supervisor.get("/api/issues")).status).toBe(403);
  });

  it("keeps merchandisers out of the supervisor update", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const response = await merchandiser.post("/api/supervisor/updates/sync").send({ updates: [{}] });
    expect(response.status).toBe(403);
  });
});

describe("order setup", () => {
  async function newOrderBody(overrides: Record<string, unknown> = {}) {
    const [buyer, unit, template] = await Promise.all([
      prisma.buyer.findFirstOrThrow({ where: { name: "Company B" } }),
      prisma.unit.findFirstOrThrow({ where: { name: "Unit 1" } }),
      prisma.tnaTemplate.findFirstOrThrow({ where: { name: "Plain knit" } }),
    ]);
    return {
      poNumber: "B-PO-NEW",
      buyerId: buyer.id,
      style: "Men's henley",
      colour: "Grey",
      unitId: unit.id,
      templateId: template.id,
      exFactoryDate: "2026-12-15",
      sizes: [
        { size: "M", qty: 600 },
        { size: "L", qty: 400 },
      ],
      ...overrides,
    };
  }

  it("creates milestones from the template and totals the sizes", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const created = await merchandiser.post("/api/orders").send(await newOrderBody());
    expect(created.status).toBe(201);

    const detail = await merchandiser.get(`/api/orders/${created.body.id}`);
    expect(detail.body.totalQty).toBe(1000);
    expect(detail.body.milestones.map((m: { stage: string; plannedDate: string; plannedQty: number | null }) => [m.stage, m.plannedDate, m.plannedQty])).toEqual([
      ["CUTTING", "2026-11-27", 1000],
      ["STITCHING", "2026-12-09", 1000],
      ["FINISHING", "2026-12-12", 1000], // 13 Dec is a Sunday, so it moves earlier.
      ["INSPECTION", "2026-12-14", null],
      ["EX_FACTORY", "2026-12-15", null],
    ]);
    expect(detail.body.risk.status).toBe("NO_DATA");
  });

  it("refuses a duplicate PO number", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const response = await merchandiser.post("/api/orders").send(await newOrderBody({ poNumber: "B-PO-88213" }));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PO_EXISTS");
  });

  it.each([
    ["a past ex-factory date", { exFactoryDate: "2026-11-01" }, "EX_FACTORY_IN_PAST"],
    ["no sizes", { sizes: [] }, "VALIDATION"],
    ["a zero quantity", { sizes: [{ size: "M", qty: 0 }] }, "VALIDATION"],
    ["a repeated size", { sizes: [{ size: "M", qty: 1 }, { size: "M", qty: 1 }] }, "VALIDATION"],
    ["an impossible date", { exFactoryDate: "2026-02-31" }, "VALIDATION"],
  ])("refuses %s", async (_, overrides, code) => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const response = await merchandiser.post("/api/orders").send(await newOrderBody(overrides));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
  });
});

describe("order board", () => {
  it("shows every sample order's colour, worst first, with the maths", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const { body } = await merchandiser.get("/api/orders/board");

    expect(body.orders.map((o: { poNumber: string; status: string }) => [o.poNumber, o.status])).toEqual([
      ["B-PO-88213", "RED"],
      ["B-PO-88240", "AMBER"],
      ["C-PO-0488", "GREEN"],
    ]);
    expect(body.counts).toMatchObject({ RED: 1, AMBER: 1, GREEN: 1 });
    expect(body.orders[0]).toMatchObject({
      projectedExFactory: "2026-11-23",
      focusStage: { stage: "STITCHING", neededPerDay: 743, actualPerDay: 600, slipDays: 3 },
      issue: { category: "MACHINE_BREAKDOWN", status: "PENDING" },
    });
  });

  it("filters by buyer, unit, ship week and status", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const companyC = await prisma.buyer.findFirstOrThrow({ where: { name: "Company C" } });
    const unit2 = await prisma.unit.findFirstOrThrow({ where: { name: "Unit 2" } });
    const pos = async (query: Record<string, string>) =>
      (await merchandiser.get("/api/orders/board").query(query)).body.orders.map(
        (order: { poNumber: string }) => order.poNumber,
      );

    expect(await pos({ buyerId: companyC.id })).toEqual(["C-PO-0488"]);
    expect(await pos({ unitId: unit2.id })).toEqual(["B-PO-88240"]);
    // 20 Nov 2026 is a Friday; any day that week should find it.
    expect(await pos({ shipWeek: "2026-11-16" })).toEqual(["B-PO-88213"]);
    expect(await pos({ shipWeek: "2026-11-22" })).toEqual(["B-PO-88213"]);
    expect(await pos({ status: "AMBER" })).toEqual(["B-PO-88240"]);
  });

  it("turns an order green when output recovers", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const merchandiser = await signIn(app, PRIYA);
    const { id: milestoneId } = await milestoneOf("B-PO-88213", "STITCHING");

    await supervisor.post("/api/supervisor/updates/sync").send({
      updates: [
        update(milestoneId, { workDate: "2026-11-04", qty: 1000, capturedAt: "2026-11-07T01:00:00.000Z" }),
        update(milestoneId, { workDate: "2026-11-05", qty: 1000, capturedAt: "2026-11-07T01:00:00.000Z" }),
        update(milestoneId, { workDate: "2026-11-06", qty: 1000, capturedAt: "2026-11-07T01:00:00.000Z" }),
      ],
    });

    const { body } = await merchandiser.get("/api/orders/board");
    const order = body.orders.find((o: { poNumber: string }) => o.poNumber === "B-PO-88213");
    expect(order.status).toBe("GREEN");
  });
});

describe("supervisor update sync", () => {
  const sync = (agent: Awaited<ReturnType<typeof signIn>>, updates: unknown[]) =>
    agent.post("/api/supervisor/updates/sync").send({ updates });

  it("shows only the supervisor's own unit on their worklist", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.get("/api/supervisor/worklist");
    expect(new Set(body.stages.map((s: { poNumber: string }) => s.poNumber))).toEqual(new Set(["B-PO-88213"]));
    expect(body.stages[0]).toMatchObject({ stage: "STITCHING", doneQty: 6800, todayQty: 600 });
  });

  it("counts a retried update only once", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const item = update(id, { workDate: "2026-10-24", qty: 500 });

    const first = await sync(supervisor, [item]);
    const retry = await sync(supervisor, [item]);

    expect(first.body.results[0]).toMatchObject({ status: "ACCEPTED", doneQty: 7300 });
    expect(retry.body.results[0]).toEqual({ id: item.id, status: "DUPLICATE" });
    expect((await milestoneOf("B-PO-88213", "STITCHING")).doneQty).toBe(7300);
  });

  it("counts a retry sent at the same moment only once", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const item = update(id, { workDate: "2026-10-24", qty: 500 });

    const responses = await Promise.all([sync(supervisor, [item]), sync(supervisor, [item])]);

    const statuses = responses.map((response) => response.body.results[0].status).sort();
    expect(statuses).toEqual(["ACCEPTED", "DUPLICATE"]);
    expect((await milestoneOf("B-PO-88213", "STITCHING")).doneQty).toBe(7300);
  });

  it("replaces a day's figure on correction and keeps the old row as history", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const response = await sync(supervisor, [update(id, { qty: 650, capturedAt: "2026-11-06T13:00:00.000Z" })]);

    expect(response.body.results[0]).toMatchObject({ status: "ACCEPTED", doneQty: 6850 });
    const rows = await prisma.dailyUpdate.findMany({
      where: { milestoneId: id, workDate: new Date("2026-11-06T00:00:00Z") },
    });
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.supersededAt === null).map((row) => row.qty)).toEqual([650]);
  });

  it("does not let an older queued figure overwrite a newer one", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const response = await sync(supervisor, [update(id, { qty: 9, capturedAt: "2026-11-06T05:00:00.000Z" })]);

    expect(response.body.results[0].status).toBe("STALE");
    expect((await milestoneOf("B-PO-88213", "STITCHING")).doneQty).toBe(6800);
  });

  it("refuses a total above the planned quantity and says how much fits", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const response = await sync(supervisor, [update(id, { workDate: "2026-10-24", qty: 5201 })]);

    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", code: "OVER_QUANTITY" });
    expect(response.body.results[0].message).toContain("5200");
    expect((await milestoneOf("B-PO-88213", "STITCHING")).doneQty).toBe(6800);
  });

  it("cannot be pushed over the planned quantity by two phones at once", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const responses = await Promise.all([
      sync(supervisor, [update(id, { workDate: "2026-10-24", qty: 3000 })]),
      sync(supervisor, [update(id, { workDate: "2026-10-23", qty: 3000 })]),
    ]);

    const statuses = responses.map((response) => response.body.results[0].status).sort();
    expect(statuses).toEqual(["ACCEPTED", "REJECTED"]);
    expect((await milestoneOf("B-PO-88213", "STITCHING")).doneQty).toBe(9800);
  });

  it("marks a stage complete on the last piece, and reopens it on a correction down", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    await sync(supervisor, [update(id, { workDate: "2026-10-24", qty: 5200 })]);
    expect((await milestoneOf("B-PO-88213", "STITCHING")).completedAt).not.toBeNull();

    await sync(supervisor, [update(id, { workDate: "2026-10-24", qty: 100, capturedAt: "2026-11-07T01:00:00.000Z" })]);
    expect((await milestoneOf("B-PO-88213", "STITCHING")).completedAt).toBeNull();
  });

  it("refuses another unit's stage", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, SELVI);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const response = await sync(supervisor, [update(id)]);
    expect(response.body.results[0]).toMatchObject({ status: "REJECTED", code: "WRONG_UNIT" });
  });

  it("refuses future dates, stages with no count and foreign file links", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const stitching = await milestoneOf("B-PO-88213", "STITCHING");
    const inspection = await milestoneOf("B-PO-88213", "INSPECTION");

    const { body } = await sync(supervisor, [
      update(stitching.id, { workDate: "2026-11-07" }),
      update(stitching.id, { workDate: "2026-09-01" }),
      update(inspection.id),
      update(stitching.id, { photoUrl: "https://evil.example/x.jpg" }),
      update(stitching.id, { qty: -5 }),
    ]);

    expect(body.results.map((result: { code: string }) => result.code)).toEqual([
      "FUTURE_DATE",
      "TOO_OLD",
      "NOT_QUANTITY_STAGE",
      "INVALID",
      "INVALID",
    ]);
  });

  it("does not let one bad entry block the rest of the queue", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const good = update(id, { workDate: "2026-10-24", qty: 10 });

    const { body } = await sync(supervisor, [{ nonsense: true }, good]);

    expect(body.results[0]).toMatchObject({ id: null, status: "REJECTED", code: "INVALID" });
    expect(body.results[1]).toMatchObject({ id: good.id, status: "ACCEPTED" });
  });
});

describe("uploads", () => {
  it("accepts a real photo and serves it", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const uploaded = await supervisor.post("/api/supervisor/uploads").attach("file", JPEG, "line.jpg");
    expect(uploaded.status).toBe(201);
    expect((await request(app).get(uploaded.body.url)).status).toBe(200);
  });

  it("judges a file by its content, not its name", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const fake = Buffer.from("<script>alert(1)</script>............");
    const response = await supervisor.post("/api/supervisor/uploads").attach("file", fake, "line.jpg");
    expect(response.status).toBe(415);
  });
});

describe("AI note step", () => {
  const syncNote = async (app: ReturnType<typeof testApp>["app"], fields: Record<string, unknown>) => {
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const item = update(id, { workDate: "2026-10-24", ...fields });
    const response = await supervisor.post("/api/supervisor/updates/sync").send({ updates: [item] });
    return { item, response };
  };
  const issueFor = (dailyUpdateId: string) => prisma.issue.findUniqueOrThrow({ where: { dailyUpdateId } });

  it("translates and categorises a Tamil note after the update is saved", async () => {
    const classify = vi.fn().mockResolvedValue(machineNote);
    const { app, aiQueue } = testApp({ classify });
    const { item, response } = await syncNote(app, { noteText: "இரண்டு மெஷின் பழுது" });

    expect(response.body.results[0].status).toBe("ACCEPTED");
    await aiQueue.idle();

    expect(classify).toHaveBeenCalledWith("இரண்டு மெஷின் பழுது");
    expect(await issueFor(item.id)).toMatchObject({
      originalText: "இரண்டு மெஷின் பழுது",
      translatedText: "2 machines broke",
      aiStatus: "COMPLETED",
      aiCategory: "MACHINE_BREAKDOWN",
      status: "PENDING",
    });
  });

  it("saves the update even when the AI is down, then retries and gives up safely", async () => {
    const classify = vi.fn().mockRejectedValue(new Error("Service unavailable"));
    const { app, aiQueue } = testApp({ classify });
    const { item, response } = await syncNote(app, { noteText: "மின்சாரம் இல்லை", qty: 50 });

    expect(response.body.results[0]).toMatchObject({ status: "ACCEPTED", doneQty: 6850 });
    await aiQueue.idle();
    expect(await issueFor(item.id)).toMatchObject({ aiStatus: "PENDING", aiAttempts: 1 });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await aiQueue.sweep();
      await aiQueue.idle();
    }

    expect(classify).toHaveBeenCalledTimes(3);
    expect(await issueFor(item.id)).toMatchObject({
      aiStatus: "FAILED",
      aiAttempts: 3,
      aiCategory: null,
      originalText: "மின்சாரம் இல்லை",
      aiError: "Service unavailable",
    });
  });

  it("recovers on a later attempt", async () => {
    const classify = vi
      .fn()
      .mockRejectedValueOnce(new ClassificationError("The model did not return valid JSON"))
      .mockResolvedValueOnce(machineNote);
    const { app, aiQueue } = testApp({ classify });
    const { item } = await syncNote(app, { noteText: "மெஷின்" });

    await aiQueue.idle();
    await aiQueue.sweep();
    await aiQueue.idle();

    expect(await issueFor(item.id)).toMatchObject({ aiStatus: "COMPLETED", aiError: null, aiAttempts: 2 });
  });

  it("sends notes straight to a person when no AI is configured", async () => {
    const { app, aiQueue } = testApp(null);
    const { item } = await syncNote(app, { noteText: "மெஷின்" });
    await aiQueue.idle();
    expect(await issueFor(item.id)).toMatchObject({ aiStatus: "FAILED", aiError: "AI_NOT_CONFIGURED" });
  });

  it("holds a voice note with no text for a person, without calling the AI", async () => {
    const classify = vi.fn();
    const { app, aiQueue } = testApp({ classify });
    const supervisor = await signIn(app, MURUGAN);
    const uploaded = await supervisor.post("/api/supervisor/uploads").attach("file", Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32)]), "note.ogg");
    const { item } = await syncNote(app, { voiceUrl: uploaded.body.url });
    await aiQueue.idle();

    expect(classify).not.toHaveBeenCalled();
    expect(await issueFor(item.id)).toMatchObject({ aiStatus: "FAILED", aiError: "VOICE_NOT_TRANSCRIBED" });
  });

  describe("voice notes", () => {
    const VOICE = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32, 7)]);
    const recordVoiceNote = async (app: ReturnType<typeof testApp>["app"]) => {
      const supervisor = await signIn(app, MURUGAN);
      const uploaded = await supervisor.post("/api/supervisor/uploads").attach("file", VOICE, "note.ogg");
      return syncNote(app, { voiceUrl: uploaded.body.url });
    };

    it("writes down what was said, then translates and categorises it", async () => {
      const transcribe = vi.fn().mockResolvedValue("இரண்டு மெஷின் பழுது");
      const classify = vi.fn().mockResolvedValue(machineNote);
      const { app, aiQueue } = testApp({ classify }, undefined, undefined, { transcribe });
      const { item } = await recordVoiceNote(app);
      await aiQueue.idle();

      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(Buffer.compare(transcribe.mock.calls[0]![0] as Buffer, VOICE)).toBe(0);
      expect(classify).toHaveBeenCalledWith("இரண்டு மெஷின் பழுது");
      expect(await issueFor(item.id)).toMatchObject({
        originalText: "இரண்டு மெஷின் பழுது",
        aiStatus: "COMPLETED",
        aiCategory: "MACHINE_BREAKDOWN",
      });
    });

    it("tries again later when speech-to-text fails, and keeps the transcript once it has one", async () => {
      const transcribe = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue("நூல் இல்லை");
      const classify = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(machineNote);
      const { app, aiQueue } = testApp({ classify }, undefined, undefined, { transcribe });
      const { item } = await recordVoiceNote(app);
      await aiQueue.idle();
      expect(await issueFor(item.id)).toMatchObject({ aiStatus: "PENDING", aiAttempts: 1, originalText: "" });

      await aiQueue.sweep();
      await aiQueue.idle();
      expect(await issueFor(item.id)).toMatchObject({ aiStatus: "PENDING", originalText: "நூல் இல்லை" });

      await aiQueue.sweep();
      await aiQueue.idle();
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(await issueFor(item.id)).toMatchObject({ aiStatus: "COMPLETED", originalText: "நூல் இல்லை" });
    });

    it("sends a recording with no speech to a person without calling the classifier", async () => {
      const classify = vi.fn();
      const { app, aiQueue } = testApp({ classify }, undefined, undefined, { transcribe: async () => "" });
      const { item } = await recordVoiceNote(app);
      await aiQueue.idle();

      expect(classify).not.toHaveBeenCalled();
      expect(await issueFor(item.id)).toMatchObject({ aiStatus: "FAILED", aiError: "NO_SPEECH" });
    });

    it("lets a merchandiser send a failed voice note back through", async () => {
      const { app, aiQueue } = testApp({ classify: vi.fn() });
      const { item } = await recordVoiceNote(app);
      await aiQueue.idle();
      const issue = await issueFor(item.id);
      expect(issue.aiError).toBe("VOICE_NOT_TRANSCRIBED");

      const merchandiser = await signIn(app, PRIYA);
      const retried = await merchandiser.post(`/api/issues/${issue.id}/retry`);
      expect(retried.status).toBe(202);
    });
  });

  it("flags low confidence for review and lets a person correct it", async () => {
    const classify = vi.fn().mockResolvedValue({ translation: "Thread problem", category: "OTHER", confidence: 0.4 });
    const { app, aiQueue } = testApp({ classify });
    const { item } = await syncNote(app, { noteText: "நூல் பிரச்சனை" });
    await aiQueue.idle();

    const merchandiser = await signIn(app, PRIYA);
    const issue = await issueFor(item.id);
    const listed = await merchandiser.get("/api/issues");
    const entry = listed.body.issues.find((candidate: { id: string }) => candidate.id === issue.id);
    expect(entry).toMatchObject({ needsReview: true, originalText: "நூல் பிரச்சனை", translatedText: "Thread problem" });

    const reviewed = await merchandiser
      .post(`/api/issues/${issue.id}/review`)
      .send({ action: "CONFIRM", category: "TRIMS_SHORTAGE", translatedText: "Thread shortage" });
    expect(reviewed.status).toBe(204);
    expect(await issueFor(item.id)).toMatchObject({
      aiCategory: "OTHER",
      finalCategory: "TRIMS_SHORTAGE",
      translatedText: "Thread shortage",
      status: "CONFIRMED",
    });

    const accuracy = await merchandiser.get("/api/issues/accuracy");
    expect(accuracy.body).toEqual({ reviewed: 1, agreed: 0 });
  });

  it("makes a person choose a category when the AI gave none", async () => {
    const { app, aiQueue } = testApp(null);
    const { item } = await syncNote(app, { noteText: "மெஷின்" });
    await aiQueue.idle();
    const merchandiser = await signIn(app, PRIYA);
    const issue = await issueFor(item.id);
    const response = await merchandiser.post(`/api/issues/${issue.id}/review`).send({ action: "CONFIRM" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CATEGORY_REQUIRED");
  });

  it("sends a failed note back through the AI on request", async () => {
    const classify = vi.fn().mockResolvedValue(machineNote);
    const { app, aiQueue } = testApp({ classify });
    const { item } = await syncNote(app, { noteText: "மெஷின்" });
    await aiQueue.idle();
    await prisma.issue.update({ where: { dailyUpdateId: item.id }, data: { aiStatus: "FAILED", aiAttempts: 3 } });

    const merchandiser = await signIn(app, PRIYA);
    const issue = await issueFor(item.id);
    expect((await merchandiser.post(`/api/issues/${issue.id}/retry`)).status).toBe(202);
    await aiQueue.idle();
    expect(await issueFor(item.id)).toMatchObject({ aiStatus: "COMPLETED" });
  });
});

describe("buyer link", () => {
  const asBuyer = (app: ReturnType<typeof testApp>["app"], token: string | undefined) => {
    const get = (path: string) => {
      const call = request(app).get(`/api/buyer${path}`);
      return token ? call.set("x-buyer-token", token) : call;
    };
    return { get };
  };

  it("shows a buyer only their own orders", async () => {
    const { app } = testApp();
    const { body } = await asBuyer(app, tokens["Company B"]).get("/orders");
    expect(body.orders.map((o: { poNumber: string }) => o.poNumber).sort()).toEqual(["B-PO-88213", "B-PO-88240"]);
    expect(JSON.stringify(body)).not.toContain("C-PO-0488");
    expect(JSON.stringify(body)).not.toContain("Kids printed");
  });

  it("never returns another buyer's order, even by its exact id", async () => {
    const { app } = testApp();
    const other = await orderOf("C-PO-0488");
    const response = await asBuyer(app, tokens["Company B"]).get(`/orders/${other.id}`);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("0488");
  });

  it("gives the same refusal for a missing, wrong, revoked or expired link", async () => {
    const { app } = testApp();
    const missing = await asBuyer(app, undefined).get("/orders");
    const wrong = await asBuyer(app, "made-up-token").get("/orders");

    const company = await prisma.buyer.findFirstOrThrow({ where: { name: "Company B" } });
    await prisma.buyerLink.updateMany({ where: { buyerId: company.id }, data: { revokedAt: new Date() } });
    const revoked = await asBuyer(app, tokens["Company B"]).get("/orders");

    const other = await prisma.buyer.findFirstOrThrow({ where: { name: "Company C" } });
    await prisma.buyerLink.updateMany({ where: { buyerId: other.id }, data: { expiresAt: new Date(0) } });
    const expired = await asBuyer(app, tokens["Company C"]).get("/orders");

    for (const response of [missing, wrong, revoked, expired]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_LINK");
    }
  });

  it("stores only a hash of the token", async () => {
    const links = await prisma.buyerLink.findMany();
    expect(links.map((link) => link.tokenHash)).not.toContain(tokens["Company B"]);
  });

  it("lets a merchandiser create and revoke a link", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const company = await prisma.buyer.findFirstOrThrow({ where: { name: "Company C" } });

    const created = await merchandiser.post(`/api/buyers/${company.id}/links`).send({ expiresInDays: 7 });
    expect((await asBuyer(app, created.body.token).get("/orders")).status).toBe(200);

    await merchandiser.post(`/api/buyer-links/${created.body.id}/revoke`);
    expect((await asBuyer(app, created.body.token).get("/orders")).status).toBe(401);

    const listed = await merchandiser.get(`/api/buyers/${company.id}/links`);
    expect(JSON.stringify(listed.body)).not.toContain("tokenHash");
  });

  it("does not expose internal figures, notes, units or staff", async () => {
    const { app } = testApp();
    const order = await orderOf("B-PO-88213");
    const { body } = await asBuyer(app, tokens["Company B"]).get(`/orders/${order.id}`);
    const text = JSON.stringify(body);

    expect(body.milestones.find((m: { stage: string }) => m.stage === "STITCHING").percentDone).toBe(56);
    for (const hidden of ["Unit 1", "Murugan", "neededPerDay", "actualPerDay", "projected", "பழுதானது", "machines broke"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("shows a warning only after a merchandiser confirms it", async () => {
    const { app } = testApp();
    const order = await orderOf("B-PO-88213");
    const buyer = asBuyer(app, tokens["Company B"]);

    // The order is red with an AI-labelled issue, but nobody has confirmed it.
    expect((await buyer.get(`/orders/${order.id}`)).body).toMatchObject({ progress: "IN_PROGRESS", reason: null });

    const merchandiser = await signIn(app, PRIYA);
    const issue = await prisma.issue.findFirstOrThrow({
      where: { dailyUpdate: { milestone: { orderId: order.id } } },
    });
    await merchandiser.post(`/api/issues/${issue.id}/review`).send({ action: "CONFIRM" });

    expect((await buyer.get(`/orders/${order.id}`)).body).toMatchObject({
      progress: "DELAYED",
      reason: "Machine breakdown",
    });
  });

  it("shows no warning for a dismissed issue", async () => {
    const { app } = testApp();
    const order = await orderOf("B-PO-88213");
    const merchandiser = await signIn(app, PRIYA);
    const issue = await prisma.issue.findFirstOrThrow({
      where: { dailyUpdate: { milestone: { orderId: order.id } } },
    });
    await merchandiser.post(`/api/issues/${issue.id}/review`).send({ action: "DISMISS" });

    const { body } = await asBuyer(app, tokens["Company B"]).get(`/orders/${order.id}`);
    expect(body).toMatchObject({ progress: "IN_PROGRESS", reason: null });
  });

  it("holds back a photo while its note is unreviewed", async () => {
    const classify = vi.fn().mockResolvedValue(machineNote);
    const { app, aiQueue } = testApp({ classify });
    const supervisor = await signIn(app, MURUGAN);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");
    const plain = (await supervisor.post("/api/supervisor/uploads").attach("file", JPEG, "a.jpg")).body.url;
    const flagged = (await supervisor.post("/api/supervisor/uploads").attach("file", JPEG, "b.jpg")).body.url;

    await supervisor.post("/api/supervisor/updates/sync").send({
      updates: [
        update(id, { workDate: "2026-10-24", qty: 1, photoUrl: plain }),
        update(id, { workDate: "2026-10-23", qty: 1, photoUrl: flagged, noteText: "மெஷின் பழுது" }),
      ],
    });
    await aiQueue.idle();

    const order = await orderOf("B-PO-88213");
    const buyer = asBuyer(app, tokens["Company B"]);
    const urls = async () =>
      (await buyer.get(`/orders/${order.id}`)).body.photos.map((photo: { url: string }) => photo.url);
    expect(await urls()).toEqual([plain]);

    const merchandiser = await signIn(app, PRIYA);
    const issue = await prisma.issue.findFirstOrThrow({ where: { originalText: "மெஷின் பழுது" } });
    await merchandiser.post(`/api/issues/${issue.id}/review`).send({ action: "CONFIRM" });
    expect(await urls()).toEqual([plain, flagged]);
  });
});

describe("date history", () => {
  it("records who changed a milestone date, from what, to what and why", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const response = await merchandiser
      .patch(`/api/milestones/${id}/date`)
      .send({ date: "2026-11-16", reason: "Sunday shift agreed" });
    expect(response.status).toBe(204);

    const order = await orderOf("B-PO-88213");
    const detail = await merchandiser.get(`/api/orders/${order.id}`);
    expect(detail.body.dateHistory[0]).toMatchObject({
      stage: "STITCHING",
      from: "2026-11-14",
      to: "2026-11-16",
      reason: "Sunday shift agreed",
      by: "Priya",
    });
  });

  it("shows a buyer the history of their own order", async () => {
    const { app } = testApp();
    const order = await orderOf("B-PO-88240");
    const response = await request(app)
      .get(`/api/buyer/orders/${order.id}`)
      .set("x-buyer-token", tokens["Company B"]!);
    expect(response.body.dateHistory).toHaveLength(1);
    expect(response.body.dateHistory[0]).toMatchObject({ stage: "FINISHING", from: "2026-11-09", to: "2026-11-10" });
  });

  it("requires a reason and refuses a date after ex-factory", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const { id } = await milestoneOf("B-PO-88213", "STITCHING");

    const noReason = await merchandiser.patch(`/api/milestones/${id}/date`).send({ date: "2026-11-16" });
    const tooLate = await merchandiser
      .patch(`/api/milestones/${id}/date`)
      .send({ date: "2026-11-25", reason: "Too late" });

    expect(noReason.status).toBe(400);
    expect(tooLate.body.error.code).toBe("AFTER_EX_FACTORY");
    expect(await prisma.auditLog.count({ where: { entityId: id } })).toBe(0);
  });

  it("moves the ex-factory date on the order and its milestone, with history", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const order = await orderOf("B-PO-88213");

    const { body } = await merchandiser
      .patch(`/api/orders/${order.id}/ex-factory`)
      .send({ date: "2026-11-25", reason: "Buyer agreed a new date" });

    expect(body.exFactoryDate).toBe("2026-11-25");
    expect(body.milestones.at(-1)).toMatchObject({ stage: "EX_FACTORY", plannedDate: "2026-11-25" });
    expect(body.dateHistory[0]).toMatchObject({ stage: "ORDER", from: "2026-11-20", to: "2026-11-25" });
  });
});

describe("shipping", () => {
  it("refuses to ship while stages are unfinished, then removes a shipped order from the board", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const shipment = await milestoneOf("C-PO-0488", "EX_FACTORY");

    const early = await merchandiser.post(`/api/milestones/${shipment.id}/complete`);
    expect(early.status).toBe(409);

    await prisma.milestone.updateMany({
      where: { order: { poNumber: "C-PO-0488" }, plannedQty: { not: null } },
      data: { doneQty: 10000 },
    });
    expect((await merchandiser.post(`/api/milestones/${shipment.id}/complete`)).status).toBe(204);

    const { body } = await merchandiser.get("/api/orders/board");
    expect(body.orders.map((o: { poNumber: string }) => o.poNumber)).not.toContain("C-PO-0488");
  });
});

describe("error responses", () => {
  it("returns a clean error for broken JSON and unknown routes", async () => {
    const { app } = testApp();
    const broken = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("BAD_JSON");

    const merchandiser = await signIn(app, PRIYA);
    const missing = await merchandiser.get("/api/nothing-here");
    expect(missing.status).toBe(404);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { milestoneOf, MURUGAN, PRIYA, seed, signIn, testApp, TODAY, update } from "./helpers.js";

const KUMAR = "kumar@companya.example";
const LAKSHMI = "lakshmi@printpartner.example";

const send = (agent: Awaited<ReturnType<typeof signIn>>, items: unknown[]) =>
  agent.post("/api/supervisor/updates/sync").send({ updates: items });

describe("stage counts follow production order", () => {
  beforeEach(seed);

  it("refuses more finished pieces than were stitched", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const finishing = await milestoneOf("B-PO-88213", "FINISHING");

    const { body } = await send(supervisor, [update(finishing.id, { qty: 6801 })]);
    expect(body.results[0]).toMatchObject({ status: "REJECTED", code: "AHEAD_OF_PREVIOUS" });
    expect(body.results[0].message).toContain("6800");

    const allowed = await send(supervisor, [update(finishing.id, { qty: 6800 })]);
    expect(allowed.body.results[0]).toMatchObject({ status: "ACCEPTED", doneQty: 6800 });
  });

  it("refuses a correction that leaves a stage below the one after it", async () => {
    const { app } = testApp();
    const stitcher = await signIn(app, KUMAR);
    const printer = await signIn(app, LAKSHMI);
    const stitching = await milestoneOf("C-PO-0488", "STITCHING");
    const printing = await milestoneOf("C-PO-0488", "PRINTING");

    // 3,100 printed, so 3,000 can be stitched.
    expect((await send(stitcher, [update(stitching.id, { qty: 3000 })])).body.results[0].status).toBe("ACCEPTED");

    // Lowering today's printing from 1,050 to 0 would leave 2,050 printed but 3,000 stitched.
    const { body } = await send(printer, [update(printing.id, { qty: 0, capturedAt: `${TODAY}T13:00:00.000Z` })]);
    expect(body.results[0]).toMatchObject({ status: "REJECTED", code: "BELOW_NEXT" });
    expect((await milestoneOf("C-PO-0488", "PRINTING")).doneQty).toBe(3100);
  });

  it("tells the phone how far each stage can go", async () => {
    const { app } = testApp();
    const supervisor = await signIn(app, MURUGAN);
    const { body } = await supervisor.get("/api/supervisor/worklist");
    const byStage = new Map(body.stages.map((stage: { stage: string }) => [stage.stage, stage]));
    expect(byStage.get("STITCHING")).toMatchObject({ capQty: 12000 });
    expect(byStage.get("FINISHING")).toMatchObject({ capQty: 6800 });
  });
});

describe("milestone dates follow production order", () => {
  beforeEach(seed);

  it("refuses a date after the next stage or before the previous one", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const stitching = await milestoneOf("B-PO-88213", "STITCHING");

    const afterFinishing = await merchandiser
      .patch(`/api/milestones/${stitching.id}/date`)
      .send({ date: "2026-11-19", reason: "Machine repaired" });
    const beforeCutting = await merchandiser
      .patch(`/api/milestones/${stitching.id}/date`)
      .send({ date: "2026-11-01", reason: "Pulled forward" });

    expect(afterFinishing.body.error).toMatchObject({ code: "OUT_OF_ORDER" });
    expect(afterFinishing.body.error.message).toContain("finishing");
    expect(beforeCutting.body.error).toMatchObject({ code: "OUT_OF_ORDER" });
    expect((await milestoneOf("B-PO-88213", "STITCHING")).plannedDate.toISOString().slice(0, 10)).toBe("2026-11-14");
  });

  it("allows a date that keeps the order", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const stitching = await milestoneOf("B-PO-88213", "STITCHING");
    const response = await merchandiser
      .patch(`/api/milestones/${stitching.id}/date`)
      .send({ date: "2026-11-18", reason: "Sunday shift agreed" });
    expect(response.status).toBe(204);
  });
});

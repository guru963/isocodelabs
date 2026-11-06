import { describe, expect, it } from "vitest";
import { addWorkingDays, countWorkingDays, workingDayOnOrBefore } from "./calendar.js";
import { computeOrderRisk, computeStageRisk, type StageInput } from "./engine.js";

const TODAY = "2026-11-06"; // A Friday; Sunday 8 Nov is not a working day.
const context = { today: TODAY, holidays: new Set<string>() };

const navyTeeStitching: StageInput = {
  stage: "STITCHING",
  plannedQty: 12000,
  doneQty: 6800,
  milestoneDate: "2026-11-14",
  outputs: [
    { date: "2026-11-04", qty: 620 },
    { date: "2026-11-05", qty: 580 },
    { date: "2026-11-06", qty: 600 },
  ],
};

describe("calendar", () => {
  const none = new Set<string>();

  it("skips Sundays and holidays when counting", () => {
    expect(countWorkingDays("2026-11-06", "2026-11-14", none)).toBe(7);
    expect(countWorkingDays("2026-11-06", "2026-11-14", new Set(["2026-11-10"]))).toBe(6);
  });

  it("skips Sundays and holidays when adding", () => {
    expect(addWorkingDays("2026-11-06", 9, none)).toBe("2026-11-17");
    expect(addWorkingDays("2026-11-06", 2, new Set(["2026-11-07"]))).toBe("2026-11-10");
  });

  it("rolls a non-working date back", () => {
    expect(workingDayOnOrBefore("2026-11-22", none)).toBe("2026-11-21");
    expect(workingDayOnOrBefore("2026-11-21", none)).toBe("2026-11-21");
  });
});

describe("computeStageRisk", () => {
  it("shows the maths for the navy tee: 743 needed, 600 made, 3 days late", () => {
    expect(computeStageRisk(navyTeeStitching, context)).toMatchObject({
      status: "RED",
      flags: [],
      remainingQty: 5200,
      workingDaysLeft: 7,
      neededPerDay: 743,
      actualPerDay: 600,
      shortfallPerDay: 143,
      projectedDate: "2026-11-17",
      slipDays: 3,
    });
  });

  it("counts today as a working day until today's number is reported", () => {
    const outputs = navyTeeStitching.outputs.filter((output) => output.date !== TODAY);
    const risk = computeStageRisk({ ...navyTeeStitching, outputs }, context);
    expect(risk.workingDaysLeft).toBe(8);
    expect(risk.neededPerDay).toBe(650);
  });

  it("is green when the rate meets the milestone", () => {
    const risk = computeStageRisk({ ...navyTeeStitching, milestoneDate: "2026-11-17" }, context);
    expect(risk).toMatchObject({ status: "GREEN", slipDays: 0, shortfallPerDay: 0 });
  });

  it("is amber below the red threshold", () => {
    const risk = computeStageRisk({ ...navyTeeStitching, milestoneDate: "2026-11-16" }, context);
    expect(risk).toMatchObject({ status: "AMBER", slipDays: 1 });
  });

  it("reports a negative slip when ahead of plan", () => {
    const risk = computeStageRisk({ ...navyTeeStitching, milestoneDate: "2026-11-20" }, context);
    expect(risk).toMatchObject({ status: "GREEN", slipDays: -3 });
  });

  it("honours custom thresholds", () => {
    const config = { rateWindowDays: 3, amberFromDays: 1, redFromDays: 5, staleAfterWorkingDays: 3 };
    expect(computeStageRisk(navyTeeStitching, { ...context, config }).status).toBe("AMBER");
  });

  it("is done when every piece is made, whatever the date", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, doneQty: 12000, milestoneDate: "2026-11-01" },
      context,
    );
    expect(risk).toMatchObject({ status: "DONE", remainingQty: 0, flags: [] });
  });

  it("never gives a false green when nothing was ever reported", () => {
    const risk = computeStageRisk({ ...navyTeeStitching, doneQty: 0, outputs: [] }, context);
    expect(risk).toMatchObject({ status: "NO_DATA", projectedDate: null, neededPerDay: 1500 });
  });

  it("is not started while the previous stage is still due", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, doneQty: 0, outputs: [], previousMilestoneDate: "2026-11-10" },
      context,
    );
    expect(risk.status).toBe("NOT_STARTED");
  });

  it("expects a report once the previous stage's milestone has passed", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, doneQty: 0, outputs: [], previousMilestoneDate: "2026-11-05" },
      context,
    );
    expect(risk.status).toBe("NO_DATA");
  });

  it("is red when the milestone passed with no reports at all", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, doneQty: 0, outputs: [], milestoneDate: "2026-11-05" },
      context,
    );
    expect(risk).toMatchObject({ status: "RED", flags: ["MILESTONE_PASSED"], neededPerDay: null });
  });

  it("is red when the milestone passed, even by a day and a fast rate", () => {
    const risk = computeStageRisk(
      {
        ...navyTeeStitching,
        doneQty: 11900,
        milestoneDate: "2026-11-05",
        outputs: [{ date: TODAY, qty: 600 }],
      },
      context,
    );
    expect(risk.status).toBe("RED");
    expect(risk.flags).toContain("MILESTONE_PASSED");
    expect(risk.slipDays).toBe(2);
  });

  it("is red with no projection when output has been zero", () => {
    const outputs = ["2026-11-04", "2026-11-05", TODAY].map((date) => ({ date, qty: 0 }));
    const risk = computeStageRisk({ ...navyTeeStitching, outputs }, context);
    expect(risk).toMatchObject({ status: "RED", actualPerDay: 0, projectedDate: null });
    expect(risk.flags).toContain("NO_OUTPUT");
  });

  it("flags low confidence from a single reported day, but still projects", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, outputs: [{ date: TODAY, qty: 600 }] },
      context,
    );
    expect(risk.flags).toContain("LOW_CONFIDENCE");
    expect(risk.projectedDate).toBe("2026-11-17");
  });

  it("does not let silent supervisors keep an order green", () => {
    const risk = computeStageRisk(
      {
        ...navyTeeStitching,
        milestoneDate: "2026-11-30",
        outputs: [
          { date: "2026-10-30", qty: 600 },
          { date: "2026-10-31", qty: 600 },
          { date: "2026-11-02", qty: 600 },
        ],
      },
      context,
    );
    expect(risk.status).toBe("AMBER");
    expect(risk.flags).toContain("STALE_DATA");
  });

  it("adds up two supervisors reporting the same day", () => {
    const risk = computeStageRisk(
      {
        ...navyTeeStitching,
        outputs: [
          { date: "2026-11-04", qty: 600 },
          { date: "2026-11-05", qty: 600 },
          { date: TODAY, qty: 400 },
          { date: TODAY, qty: 200 },
        ],
      },
      context,
    );
    expect(risk.actualPerDay).toBe(600);
    expect(risk.flags).not.toContain("LOW_CONFIDENCE");
  });

  it("ignores output dated in the future", () => {
    const risk = computeStageRisk(
      { ...navyTeeStitching, outputs: [...navyTeeStitching.outputs, { date: "2026-11-09", qty: 9999 }] },
      context,
    );
    expect(risk.actualPerDay).toBe(600);
  });

  it("removes holidays from the days left and the projection", () => {
    const risk = computeStageRisk(navyTeeStitching, { ...context, holidays: new Set(["2026-11-10"]) });
    expect(risk).toMatchObject({ workingDaysLeft: 6, neededPerDay: 867, projectedDate: "2026-11-18" });
  });
});

describe("computeOrderRisk", () => {
  const cutting: StageInput = {
    stage: "CUTTING",
    plannedQty: 12000,
    doneQty: 12000,
    milestoneDate: "2026-11-02",
    outputs: [],
  };
  const finishing: StageInput = {
    stage: "FINISHING",
    plannedQty: 12000,
    doneQty: 0,
    milestoneDate: "2026-11-18",
    previousMilestoneDate: "2026-11-14",
    outputs: [],
  };

  it("pushes a stage's slip through to the ex-factory date", () => {
    const risk = computeOrderRisk(
      { exFactoryDate: "2026-11-20", stages: [cutting, navyTeeStitching, finishing] },
      context,
    );
    expect(risk).toMatchObject({
      status: "RED",
      projectedExFactory: "2026-11-23",
      exFactorySlipDays: 3,
    });
  });

  it("takes the worst of the active stages and skips done and unstarted ones", () => {
    const risk = computeOrderRisk(
      { exFactoryDate: "2026-11-20", stages: [cutting, finishing] },
      context,
    );
    expect(risk.stages.map((stage) => stage.status)).toEqual(["DONE", "NOT_STARTED"]);
    expect(risk.status).toBe("NOT_STARTED");
  });

  it("is done when every stage is done", () => {
    const risk = computeOrderRisk({ exFactoryDate: "2026-11-20", stages: [cutting] }, context);
    expect(risk).toMatchObject({ status: "DONE", projectedExFactory: null });
  });
});

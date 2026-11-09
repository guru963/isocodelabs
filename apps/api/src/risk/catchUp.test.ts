import { describe, expect, it } from "vitest";
import { planCatchUp } from "./catchUp.js";
import { computeStageRisk, type StageInput } from "./engine.js";

const TODAY = "2026-11-06"; // A Friday; Sunday 8 Nov is not a working day.
const none = new Set<string>();

/** B-PO-88240's finishing stage: 800 a day against the 934 it needs to meet 10 Nov. */
const finishing: StageInput = {
  stage: "FINISHING",
  plannedQty: 8000,
  doneQty: 5200,
  milestoneDate: "2026-11-10",
  outputs: [
    { date: "2026-11-04", qty: 800 },
    { date: "2026-11-05", qty: 800 },
    { date: "2026-11-06", qty: 800 },
  ],
};

const riskOf = (input: StageInput, holidays: ReadonlySet<string> = none) => computeStageRisk(input, { today: TODAY, holidays });
const inspectionOn = (plannedDate: string) => ({ stage: "INSPECTION", plannedDate });

describe("planCatchUp", () => {
  it("states the daily output that meets the milestone, against today's pace", () => {
    const plan = planCatchUp(riskOf(finishing), none, inspectionOn("2026-11-11"));
    expect(plan).toMatchObject({ stage: "FINISHING", milestoneDate: "2026-11-10", projectedDate: "2026-11-11", slipDays: 1 });
    expect(plan?.raiseOutput).toEqual({ perDay: 934, currentPerDay: 800, increasePercent: 17, realistic: true });
    // A realistic option exists, so there is no last resort.
    expect(plan?.lastResort).toBeNull();
  });

  it("finds the Sunday that recovers the missing day at the current pace", () => {
    // 2,800 left at 800 a day is 4 working days; Saturday, Monday and Tuesday give only 3.
    const plan = planCatchUp(riskOf(finishing), none, inspectionOn("2026-11-11"));
    expect(plan?.extraDays).toEqual({ dates: ["2026-11-08"], enough: true, shortByDays: 0 });
  });

  it("counts a holiday before the milestone as a day that can be worked", () => {
    const holidays = new Set(["2026-11-09"]);
    const plan = planCatchUp(riskOf(finishing, holidays), holidays, inspectionOn("2026-11-11"));
    // With Monday off, two days are missing; Sunday and the holiday Monday cover them.
    expect(plan?.extraDays).toEqual({ dates: ["2026-11-08", "2026-11-09"], enough: true, shortByDays: 0 });
  });

  it("says how short even every day off would leave a stage far behind", () => {
    const slow = { ...finishing, doneQty: 2000, outputs: finishing.outputs.map((day) => ({ ...day, qty: 400 })) };
    const plan = planCatchUp(riskOf(slow), none, inspectionOn("2026-11-11"));
    // 6,000 left at 400 a day is 15 working days against 3, with only one Sunday to add.
    expect(plan?.extraDays).toEqual({ dates: ["2026-11-08"], enough: false, shortByDays: 11 });
  });

  it("refuses to move the deadline when the next stage would have no day left", () => {
    const plan = planCatchUp(riskOf(finishing), none, inspectionOn("2026-11-11"));
    expect(plan?.moveDeadline).toEqual({
      to: "2026-11-11",
      nextStage: "INSPECTION",
      nextDate: "2026-11-11",
      nextHadWorkingDays: 1,
      nextKeepsWorkingDays: 0,
      feasible: false,
    });
  });

  it("moves the deadline when the next stage can absorb the day", () => {
    const plan = planCatchUp(riskOf(finishing), none, inspectionOn("2026-11-14"));
    expect(plan?.moveDeadline).toMatchObject({ to: "2026-11-11", nextHadWorkingDays: 4, nextKeepsWorkingDays: 3, feasible: true });
  });

  it("offers no extra output once the milestone has passed, only the later options", () => {
    const passed = { ...finishing, milestoneDate: "2026-11-05" };
    const plan = planCatchUp(riskOf(passed), none, inspectionOn("2026-11-14"));
    expect(plan?.raiseOutput).toBeNull();
    expect(plan?.extraDays.enough).toBe(false);
    expect(plan?.moveDeadline?.feasible).toBe(true);
  });

  it("does not offer an output far beyond what a line can stretch to", () => {
    const slow = { ...finishing, outputs: finishing.outputs.map((day) => ({ ...day, qty: 600 })) };
    const plan = planCatchUp(riskOf(slow), none, inspectionOn("2026-11-11"));
    expect(plan?.raiseOutput).toMatchObject({ perDay: 934, increasePercent: 56, realistic: false });
  });

  it("combines a stretched output with a Sunday when neither recovers the stage alone", () => {
    // 600 a day needs 5 days for 2,800; only 3 working days and one Sunday remain. A 25% stretch
    // to 750 a day needs 4, which the Sunday covers.
    const slow = { ...finishing, outputs: finishing.outputs.map((day) => ({ ...day, qty: 600 })) };
    const plan = planCatchUp(riskOf(slow), none, inspectionOn("2026-11-11"), "2026-11-12");
    expect(plan?.lastResort).toEqual({
      combined: { perDay: 750, increasePercent: 25, dates: ["2026-11-08"], finishes: "2026-11-10", slipDays: 0, recovers: true },
      exFactoryDate: "2026-11-12",
      newExFactory: null,
    });
  });

  it("gives the earliest realistic ex-factory date when even every lever is late", () => {
    // 6,000 left at 400 a day. Stretched to 500 a day it needs 12 days; with 3 working days and
    // one Sunday it ends on 19 Nov, and the 2 working days after finishing push ex-factory to 21 Nov.
    const slow = { ...finishing, doneQty: 2000, outputs: finishing.outputs.map((day) => ({ ...day, qty: 400 })) };
    const plan = planCatchUp(riskOf(slow), none, inspectionOn("2026-11-11"), "2026-11-12");
    expect(plan?.lastResort).toEqual({
      combined: { perDay: 500, increasePercent: 25, dates: ["2026-11-08"], finishes: "2026-11-19", slipDays: 9, recovers: false },
      exFactoryDate: "2026-11-12",
      newExFactory: "2026-11-21",
    });
  });

  it("has nothing to plan for a stage on time, with no pace, or with no output", () => {
    const onTime = { ...finishing, outputs: finishing.outputs.map((day) => ({ ...day, qty: 1000 })) };
    expect(planCatchUp(riskOf(onTime), none, null)).toBeNull();
    expect(planCatchUp(riskOf({ ...finishing, outputs: [] }), none, null)).toBeNull();
    const stopped = { ...finishing, outputs: finishing.outputs.map((day) => ({ ...day, qty: 0 })) };
    expect(planCatchUp(riskOf(stopped), none, null)).toBeNull();
  });
});

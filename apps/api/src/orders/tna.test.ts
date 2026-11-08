import { describe, expect, it } from "vitest";
import { earliestExFactory, planMilestones } from "./tna.js";

const PRINTED_KNIT = [
  { stage: "CUTTING", daysBeforeExFactory: 24 },
  { stage: "PRINTING", daysBeforeExFactory: 14 },
  { stage: "STITCHING", daysBeforeExFactory: 6 },
  { stage: "FINISHING", daysBeforeExFactory: 2 },
  { stage: "INSPECTION", daysBeforeExFactory: 1 },
  { stage: "EX_FACTORY", daysBeforeExFactory: 0 },
];
const none = new Set<string>();

describe("planMilestones", () => {
  it("works back from the ex-factory date", () => {
    const plan = planMilestones("2026-11-29", PRINTED_KNIT, none);
    expect(plan[0]).toEqual({ stage: "CUTTING", sequence: 1, plannedDate: "2026-11-05" });
  });

  it("moves a stage landing on a Sunday to the Saturday before", () => {
    // 2 Dec less 24 days is Sunday 8 Nov.
    expect(planMilestones("2026-12-02", PRINTED_KNIT, none)[0]?.plannedDate).toBe("2026-11-07");
  });
});

describe("earliestExFactory", () => {
  it("is today plus the longest lead time when that lands on a working day", () => {
    // Friday 6 Nov plus 24 days; cutting falls on Friday 6 Nov itself.
    expect(earliestExFactory("2026-11-06", PRINTED_KNIT, none)).toBe("2026-11-30");
  });

  it("steps past a date whose first stage would be pulled back before today", () => {
    // Sunday 8 Nov: 2 Dec would put cutting on Saturday 7 Nov, so the next day is the first that fits.
    expect(earliestExFactory("2026-11-08", PRINTED_KNIT, none)).toBe("2026-12-03");
  });

  it("treats a holiday like a Sunday", () => {
    expect(earliestExFactory("2026-11-06", PRINTED_KNIT, new Set(["2026-11-06"]))).toBe("2026-12-01");
  });
});

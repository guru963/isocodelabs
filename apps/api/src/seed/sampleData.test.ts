import { describe, expect, it } from "vitest";
import { planMilestones } from "../orders/tna.js";
import { computeOrderRisk, type StageInput } from "../risk/engine.js";
import {
  DEMO_TODAY,
  isQuantityStage,
  NO_HOLIDAYS,
  SAMPLE_ORDERS,
  TEMPLATES,
  type SeedOrder,
  type SeedStage,
} from "./sampleData.js";

const orderNamed = (poNumber: string): SeedOrder => {
  const order = SAMPLE_ORDERS.find((candidate) => candidate.poNumber === poNumber);
  if (!order) throw new Error(`No sample order ${poNumber}`);
  return order;
};

const milestonesOf = (order: SeedOrder) =>
  planMilestones<SeedStage>(order.exFactoryDate, TEMPLATES[order.template], NO_HOLIDAYS);

function riskOf(order: SeedOrder) {
  const milestones = milestonesOf(order).filter((milestone) => isQuantityStage(milestone.stage));
  const stages: StageInput[] = milestones.map((milestone, index) => {
    const outputs = order.outputs[milestone.stage] ?? [];
    return {
      stage: milestone.stage,
      plannedQty: order.totalQty,
      doneQty: outputs.reduce((sum, output) => sum + output.qty, 0),
      milestoneDate: milestone.plannedDate,
      previousMilestoneDate: milestones[index - 1]?.plannedDate,
      outputs,
    };
  });
  return computeOrderRisk(
    { exFactoryDate: order.exFactoryDate, stages },
    { today: DEMO_TODAY, holidays: NO_HOLIDAYS },
  );
}

describe("sample orders match the problem statement", () => {
  it.each([
    ["B-PO-88213", "STITCHING", 6800],
    ["B-PO-88240", "FINISHING", 5200],
    ["C-PO-0488", "PRINTING", 3100],
  ] as const)("%s has %s at the stated quantity", (poNumber, stage, qty) => {
    const outputs = orderNamed(poNumber).outputs[stage] ?? [];
    expect(outputs.reduce((sum, output) => sum + output.qty, 0)).toBe(qty);
  });

  it.each(SAMPLE_ORDERS.map((order) => [order.poNumber, order] as const))(
    "%s has sizes adding up to its total",
    (_, order) => {
      expect(Object.values(order.sizes).reduce((sum, qty) => sum + qty, 0)).toBe(order.totalQty);
    },
  );
});

describe("TNA plan", () => {
  it("gives the navy tee the worked example's dates", () => {
    expect(milestonesOf(orderNamed("B-PO-88213")).map((m) => [m.stage, m.plannedDate])).toEqual([
      ["CUTTING", "2026-11-02"],
      ["STITCHING", "2026-11-14"],
      ["FINISHING", "2026-11-18"],
      ["INSPECTION", "2026-11-19"],
      ["EX_FACTORY", "2026-11-20"],
    ]);
  });

  it("moves a Sunday milestone earlier", () => {
    const stitching = milestonesOf(orderNamed("C-PO-0488")).find((m) => m.stage === "STITCHING");
    expect(stitching?.plannedDate).toBe("2026-11-21");
  });
});

describe("the demo board on the seeded date", () => {
  it("shows B-PO-88213 red, two weeks before shipping", () => {
    const risk = riskOf(orderNamed("B-PO-88213"));
    expect(risk).toMatchObject({ status: "RED", projectedExFactory: "2026-11-23" });
    expect(risk.stages.find((stage) => stage.stage === "STITCHING")).toMatchObject({
      neededPerDay: 743,
      actualPerDay: 600,
      projectedDate: "2026-11-17",
      slipDays: 3,
    });
  });

  it("shows B-PO-88240 amber", () => {
    const risk = riskOf(orderNamed("B-PO-88240"));
    expect(risk).toMatchObject({ status: "AMBER", exFactorySlipDays: 1 });
    expect(risk.stages.find((stage) => stage.stage === "FINISHING")).toMatchObject({
      neededPerDay: 934,
      actualPerDay: 800,
      projectedDate: "2026-11-11",
    });
  });

  it("shows C-PO-0488 green", () => {
    const risk = riskOf(orderNamed("C-PO-0488"));
    expect(risk).toMatchObject({ status: "GREEN", exFactorySlipDays: 0 });
    expect(risk.stages.find((stage) => stage.stage === "PRINTING")).toMatchObject({
      neededPerDay: 986,
      actualPerDay: 1033,
      projectedDate: "2026-11-14",
    });
  });
});

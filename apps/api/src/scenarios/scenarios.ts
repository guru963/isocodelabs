import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { draftBuyerMessage, templateMessage, type BuyerMessageFacts } from "../ai/buyerMessage.js";
import { ClassificationError, needsReview, parseClassification } from "../ai/classification.js";
import type { AiQueue } from "../ai/queue.js";
import { buyerRepository } from "../buyer/buyer.repository.js";
import { toBuyerOrder } from "../buyer/buyer.routes.js";
import { loadHolidays } from "../orders/orderRisk.js";
import { earliestExFactory, planMilestones } from "../orders/tna.js";
import { planCatchUp } from "../risk/catchUp.js";
import { addDays } from "../risk/calendar.js";
import { computeOrderRisk, computeStageRisk, type StageInput } from "../risk/engine.js";
import { createUpdatesService, type SyncResult } from "../updates/updates.service.js";

export type ScenarioGroup = "Delay projection" | "Catch-up planner" | "Order setup" | "AI on notes" | "Buyer safety" | "Floor updates";

export interface ScenarioResult {
  group: ScenarioGroup;
  title: string;
  /** The situation, in plain words. */
  setup: string;
  expected: string;
  actual: string;
  pass: boolean;
}

/**
 * A fixed day for the scenarios that need no database: Friday 6 November 2026, so Sunday
 * 8 November is a day off. Fixed dates make every run give the same answer.
 */
const DAY = "2026-11-06";
const none = new Set<string>();
const risk = (input: StageInput, holidays: ReadonlySet<string> = none) => computeStageRisk(input, { today: DAY, holidays });
const daily = (qty: number, dates = ["2026-11-04", "2026-11-05", "2026-11-06"]) => dates.map((date) => ({ date, qty }));
const finishing = (qty: number, extra: Partial<StageInput> = {}): StageInput => ({
  stage: "FINISHING",
  plannedQty: 8000,
  doneQty: 5200,
  milestoneDate: "2026-11-10",
  outputs: daily(qty),
  ...extra,
});

type Check = { actual: string; pass: boolean };
interface Scenario {
  group: ScenarioGroup;
  title: string;
  setup: string;
  expected: string;
  run(): Check | Promise<Check>;
}

const pure: Scenario[] = [
  // ---- Delay projection ----
  {
    group: "Delay projection",
    title: "On pace",
    setup: "Finishing makes 1,000 a day; it needs 934 to meet 10 Nov.",
    expected: "On track",
    run() {
      const r = risk(finishing(1000));
      return { actual: `${r.status}, heading for ${r.projectedDate}`, pass: r.status === "GREEN" };
    },
  },
  {
    group: "Delay projection",
    title: "A little slow",
    setup: "Finishing makes 800 a day against the 934 it needs.",
    expected: "At risk, 1 day late",
    run() {
      const r = risk(finishing(800));
      return { actual: `${r.status}, ${r.slipDays} day(s) late, needs ${r.neededPerDay}/day`, pass: r.status === "AMBER" && r.slipDays === 1 };
    },
  },
  {
    group: "Delay projection",
    title: "Far behind",
    setup: "Finishing makes 400 a day against the 934 it needs.",
    expected: "Delayed",
    run() {
      const r = risk(finishing(400));
      return { actual: `${r.status}, ${r.slipDays} days late`, pass: r.status === "RED" };
    },
  },
  {
    group: "Delay projection",
    title: "Nothing made for three days",
    setup: "The supervisor reports 0 pieces three days running.",
    expected: "Delayed, flagged as no output",
    run() {
      const r = risk(finishing(0));
      return { actual: `${r.status}, flags: ${r.flags.join(", ") || "none"}`, pass: r.status === "RED" && r.flags.includes("NO_OUTPUT") };
    },
  },
  {
    group: "Delay projection",
    title: "Supervisor goes silent",
    setup: "The last report was 3 working days ago, at a good pace.",
    expected: "At risk, flagged as stale, never green",
    run() {
      const r = risk(finishing(1500, { outputs: daily(1500, ["2026-10-30", "2026-10-31", "2026-11-02"]), milestoneDate: "2026-11-20" }));
      return { actual: `${r.status}, flags: ${r.flags.join(", ")}`, pass: r.status === "AMBER" && r.flags.includes("STALE_DATA") };
    },
  },
  {
    group: "Delay projection",
    title: "No reports at all",
    setup: "The stage is due to have started, but nobody has reported.",
    expected: "No reports, ranked above on track",
    run() {
      const r = risk(finishing(0, { outputs: [], doneQty: 0 }));
      const order = computeOrderRisk(
        { exFactoryDate: "2026-11-12", stages: [finishing(1000), finishing(0, { stage: "INSPECTION", outputs: [], doneQty: 0 })] },
        { today: DAY, holidays: none },
      );
      return { actual: `stage ${r.status}, order ${order.status}`, pass: r.status === "NO_DATA" && order.status === "NO_DATA" };
    },
  },
  {
    group: "Delay projection",
    title: "Two supervisors, one day",
    setup: "Two supervisors each report 400 for finishing on the same days.",
    expected: "Counted as 800 a day, not 400",
    run() {
      const r = risk(finishing(400, { outputs: [...daily(400), ...daily(400)] }));
      return { actual: `${r.actualPerDay}/day`, pass: r.actualPerDay === 800 };
    },
  },
  {
    group: "Delay projection",
    title: "Milestone already passed",
    setup: "Finishing was due on 5 Nov and still has pieces left.",
    expected: "Delayed, flagged as milestone passed",
    run() {
      const r = risk(finishing(1000, { milestoneDate: "2026-11-05" }));
      return { actual: `${r.status}, flags: ${r.flags.join(", ")}`, pass: r.status === "RED" && r.flags.includes("MILESTONE_PASSED") };
    },
  },
  {
    group: "Delay projection",
    title: "A holiday in the way",
    setup: "Monday 9 Nov becomes a holiday for the unit.",
    expected: "The finish date moves one working day later",
    run() {
      const plain = risk(finishing(800));
      const holiday = risk(finishing(800), new Set(["2026-11-09"]));
      return { actual: `${plain.projectedDate} without, ${holiday.projectedDate} with`, pass: holiday.projectedDate! > plain.projectedDate! };
    },
  },
  {
    group: "Delay projection",
    title: "Ship date passed, not shipped",
    setup: "Every stage is done, but the 5 Nov ex-factory date has passed and nobody marked it shipped.",
    expected: "Delayed, until it is marked shipped",
    run() {
      const order = computeOrderRisk({ exFactoryDate: "2026-11-05", stages: [finishing(0, { doneQty: 8000 })] }, { today: DAY, holidays: none });
      return { actual: `${order.status}, overdue: ${order.exFactoryOverdue}`, pass: order.status === "RED" && order.exFactoryOverdue };
    },
  },

  // ---- Catch-up planner ----
  {
    group: "Catch-up planner",
    title: "Recover with more output",
    setup: "800 a day against 934 needed.",
    expected: "Offer 934 a day, +17%",
    run() {
      const plan = planCatchUp(risk(finishing(800)), none, { stage: "INSPECTION", plannedDate: "2026-11-11" });
      const r = plan?.raiseOutput;
      return { actual: r ? `${r.perDay}/day (+${r.increasePercent}%), realistic: ${r.realistic}` : "none", pass: r?.perDay === 934 && r.realistic };
    },
  },
  {
    group: "Catch-up planner",
    title: "Recover with a Sunday",
    setup: "One working day is missing, and Sunday 8 Nov is before the milestone.",
    expected: "Work Sunday 8 Nov",
    run() {
      const plan = planCatchUp(risk(finishing(800)), none, { stage: "INSPECTION", plannedDate: "2026-11-11" });
      return { actual: `days: ${plan?.extraDays.dates.join(", ")}, enough: ${plan?.extraDays.enough}`, pass: plan?.extraDays.dates[0] === "2026-11-08" && plan.extraDays.enough };
    },
  },
  {
    group: "Catch-up planner",
    title: "Recover by moving the deadline",
    setup: "Inspection is planned four working days after finishing.",
    expected: "Allowed; inspection keeps 3 of its 4 days",
    run() {
      const plan = planCatchUp(risk(finishing(800)), none, { stage: "INSPECTION", plannedDate: "2026-11-14" });
      const m = plan?.moveDeadline;
      return { actual: m ? `feasible: ${m.feasible}, keeps ${m.nextKeepsWorkingDays} of ${m.nextHadWorkingDays}` : "none", pass: Boolean(m?.feasible) && m?.nextKeepsWorkingDays === 3 };
    },
  },
  {
    group: "Catch-up planner",
    title: "Nothing recovers it",
    setup: "400 a day with 6,000 left, ex-factory 12 Nov.",
    expected: "No realistic option; earliest realistic ex-factory date given",
    run() {
      const plan = planCatchUp(risk(finishing(400, { doneQty: 2000 })), none, { stage: "INSPECTION", plannedDate: "2026-11-11" }, "2026-11-12");
      const last = plan?.lastResort;
      return { actual: last ? `new ex-factory ${last.newExFactory}, at ${last.combined.perDay}/day` : "no last resort", pass: last?.newExFactory === "2026-11-21" };
    },
  },
  {
    group: "Catch-up planner",
    title: "An unrealistic jump is not offered",
    setup: "600 a day against 934 needed: +56%.",
    expected: "Shown as beyond what a line can stretch to",
    run() {
      const plan = planCatchUp(risk(finishing(600)), none, { stage: "INSPECTION", plannedDate: "2026-11-11" });
      return { actual: `+${plan?.raiseOutput?.increasePercent}%, realistic: ${plan?.raiseOutput?.realistic}`, pass: plan?.raiseOutput?.realistic === false };
    },
  },

  // ---- Order setup ----
  {
    group: "Order setup",
    title: "A plan date on a Sunday",
    setup: "Cutting is 24 days before a 2 Dec ex-factory date, which is Sunday 8 Nov.",
    expected: "Moved to Saturday 7 Nov, never later",
    run() {
      const plan = planMilestones("2026-12-02", [{ stage: "CUTTING", daysBeforeExFactory: 24 }], none);
      return { actual: `cutting on ${plan[0]?.plannedDate}`, pass: plan[0]?.plannedDate === "2026-11-07" };
    },
  },
  {
    group: "Order setup",
    title: "Ship date too close for the template",
    setup: "Printed knit needs 24 days of lead time; today is Sunday 8 Nov.",
    expected: "Earliest safe ex-factory date is 3 Dec, past the Sunday trap",
    run() {
      const steps = [
        { stage: "CUTTING", daysBeforeExFactory: 24 },
        { stage: "STITCHING", daysBeforeExFactory: 6 },
      ];
      const earliest = earliestExFactory("2026-11-08", steps, none);
      return { actual: earliest, pass: earliest === "2026-12-03" };
    },
  },

  // ---- AI on notes ----
  {
    group: "AI on notes",
    title: "The model replies with something that is not JSON",
    setup: "The classifier answers in prose instead of the agreed format.",
    expected: "Rejected, so the note is retried",
    run() {
      try {
        parseClassification("Sure! This note is about a machine.");
        return { actual: "accepted", pass: false };
      } catch (error) {
        return { actual: error instanceof ClassificationError ? "rejected for retry" : "unexpected error", pass: error instanceof ClassificationError };
      }
    },
  },
  {
    group: "AI on notes",
    title: "The model invents a category",
    setup: "The classifier answers with \"BAD_WEATHER\", which is not one of the eight.",
    expected: "Kept as Other at zero confidence, for a person to check",
    run() {
      const c = parseClassification(JSON.stringify({ translation: "It rained", category: "BAD_WEATHER", confidence: 0.9 }));
      return { actual: `${c.category} at ${c.confidence}`, pass: c.category === "OTHER" && c.confidence === 0 };
    },
  },
  {
    group: "AI on notes",
    title: "The model is unsure",
    setup: "A note gives two reasons and the classifier reports 0.55 confidence.",
    expected: "Marked for a closer look",
    run() {
      const flagged = needsReview({ aiStatus: "COMPLETED", aiConfidence: 0.55 });
      return { actual: flagged ? "marked for review" : "not marked", pass: flagged };
    },
  },
  {
    group: "AI on notes",
    title: "The buyer draft states a made-up date",
    setup: "The AI's draft to the buyer offers \"30 January\", which the planner never gave it.",
    expected: "Draft rejected; the template is used",
    async run() {
      const writer = { write: async () => ({ subject: facts.poNumber, body: `New date ${facts.newExFactory}, or 30 January.` }) };
      const draft = await draftBuyerMessage(writer, facts);
      return { actual: `written by the ${draft.source}`, pass: draft.source === "template" };
    },
  },
  {
    group: "AI on notes",
    title: "The AI is down",
    setup: "The call to write the buyer draft fails.",
    expected: "The template is used, so the button never fails",
    async run() {
      const writer = { write: async () => Promise.reject(new Error("timeout")) };
      const draft = await draftBuyerMessage(writer, facts);
      const template = templateMessage(facts);
      return { actual: `written by the ${draft.source}`, pass: draft.source === "template" && draft.subject === template.subject };
    },
  },
];

const facts: BuyerMessageFacts = {
  buyerName: "Company B",
  poNumber: "B-PO-88213",
  style: "Men's crew neck tee",
  colour: "Navy",
  stage: "Finishing",
  agreedExFactory: "20 November 2026",
  newExFactory: "2 February 2027",
  reason: null,
  actions: [],
  merchandiserName: "Priya",
};

/** Never asks an AI: the floor scenarios check the counting, not the classifier. */
const quietQueue: AiQueue = { schedule: () => undefined, sweep: async () => undefined, start: () => undefined, stop: () => undefined, idle: async () => undefined };

/**
 * Scenarios against the real database. The buyer ones only read. The floor ones run on an order
 * and two supervisors made for this run alone, which are always deleted afterwards, so the
 * factory's own orders and figures are never touched.
 */
async function databaseScenarios(prisma: PrismaClient, today: () => string, merchandiserId: string): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const add = (s: Omit<ScenarioResult, "pass" | "actual">, check: Check) => results.push({ ...s, ...check });

  // ---- Buyer safety: read only ----
  const orders = await prisma.order.findMany({ select: { id: true, buyerId: true, poNumber: true } });
  const target = orders[0];
  const otherBuyer = target && orders.find((o) => o.buyerId !== target.buyerId)?.buyerId;
  if (target && otherBuyer) {
    const found = await buyerRepository(prisma, otherBuyer).findOrder(target.id);
    add(
      {
        group: "Buyer safety",
        title: "A buyer asks for another buyer's order",
        setup: `Another buyer's link requests ${target.poNumber} by its exact id.`,
        expected: "Not found",
      },
      { actual: found ? `returned ${found.poNumber}` : "not found", pass: found === null },
    );
    const own = await buyerRepository(prisma, target.buyerId).findOrder(target.id);
    if (own) {
      const holidaysFor = await loadHolidays(prisma);
      const view = toBuyerOrder(own, today(), holidaysFor) as Record<string, unknown>;
      const leaked = ["unit", "unitId", "merchandiser", "merchandiserId", "updates", "issues", "doneQty"].filter((key) => key in view);
      add(
        {
          group: "Buyer safety",
          title: "What a buyer's view contains",
          setup: `${target.poNumber} as its own buyer sees it.`,
          expected: "No unit, staff, notes or piece counts",

        },
        { actual: leaked.length ? `leaks ${leaked.join(", ")}` : `only ${Object.keys(view).join(", ")}`, pass: leaked.length === 0 },
      );
    }
  }

  // ---- Floor updates: on throwaway data ----
  const [unit1, unit2, buyer] = await Promise.all([
    prisma.unit.findFirst({ where: { type: "OWN" }, orderBy: { name: "asc" } }),
    prisma.unit.findFirst({ where: { type: "OWN" }, orderBy: { name: "desc" } }),
    prisma.buyer.findFirst(),
  ]);
  if (!unit1 || !unit2 || !buyer || unit1.id === unit2.id) return results;

  const tag = randomUUID().slice(0, 8);
  const now = today();
  const order = await prisma.order.create({
    data: {
      poNumber: `SCENARIO-${tag}`,
      buyerId: buyer.id,
      style: "Scenario check",
      colour: "None",
      totalQty: 1000,
      exFactoryDate: new Date(`${addDays(now, 30)}T00:00:00Z`),
      unitId: unit1.id,
      merchandiserId,
      milestones: {
        create: [{ stage: "CUTTING", sequence: 1, plannedDate: new Date(`${addDays(now, 20)}T00:00:00Z`), plannedQty: 1000, unitId: unit1.id }],
      },
    },
    include: { milestones: true },
  });
  const supervisor = await prisma.user.create({
    data: { email: `scenario-${tag}@scenario.invalid`, name: "Scenario", role: "SUPERVISOR", language: "en", unitId: unit1.id, passwordHash: "-" },
  });
  const outsider = await prisma.user.create({
    data: { email: `scenario-other-${tag}@scenario.invalid`, name: "Scenario", role: "SUPERVISOR", language: "en", unitId: unit2.id, passwordHash: "-" },
  });

  try {
    const service = createUpdatesService(prisma, today, quietQueue);
    const milestoneId = order.milestones[0]!.id;
    const asSupervisor = { id: supervisor.id, role: "SUPERVISOR" as const, unitId: unit1.id };
    const send = async (fields: Record<string, unknown>, user = asSupervisor): Promise<SyncResult> =>
      (await service.sync([{ id: randomUUID(), milestoneId, workDate: now, qty: 100, capturedAt: "2026-01-01T10:00:00.000Z", ...fields }], user))[0]!;
    const describe = (r: SyncResult) => ("code" in r ? `${r.status} (${r.code})` : "doneQty" in r ? `${r.status}, total ${r.doneQty}` : r.status);
    const doneQty = async () => (await prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } })).doneQty;

    const first = { id: randomUUID(), capturedAt: "2026-01-01T10:00:00.000Z", qty: 100 };
    const accepted = await send(first);
    add({ group: "Floor updates", title: "A count arrives", setup: "The supervisor sends 100 for today.", expected: "Accepted, total 100" }, { actual: describe(accepted), pass: accepted.status === "ACCEPTED" && (await doneQty()) === 100 });

    const again = await send(first);
    add(
      { group: "Floor updates", title: "The phone sends it twice", setup: "Bad signal: the same update, same id, arrives again.", expected: "Duplicate, still counted once" },
      { actual: `${describe(again)}, total ${await doneQty()}`, pass: again.status === "DUPLICATE" && (await doneQty()) === 100 },
    );

    const newer = await send({ qty: 150, capturedAt: "2026-01-01T12:00:00.000Z" });
    add(
      { group: "Floor updates", title: "A corrected count for the same day", setup: "Later that day the supervisor sends 150 instead.", expected: "Replaces the 100: total 150, not 250" },
      { actual: describe(newer), pass: newer.status === "ACCEPTED" && (await doneQty()) === 150 },
    );

    const older = await send({ qty: 90, capturedAt: "2026-01-01T09:00:00.000Z" });
    add(
      { group: "Floor updates", title: "An old count arrives late", setup: "A count typed at 9:00 reaches the server after the 12:00 one.", expected: "Stale: kept as history, the total stays 150" },
      { actual: `${describe(older)}, total ${await doneQty()}`, pass: older.status === "STALE" && (await doneQty()) === 150 },
    );

    const over = await send({ qty: 5000, capturedAt: "2026-01-01T13:00:00.000Z" });
    add({ group: "Floor updates", title: "More than the order", setup: "5,000 pieces for a 1,000-piece stage.", expected: "Rejected as over the planned quantity" }, { actual: describe(over), pass: "code" in over && over.code === "OVER_QUANTITY" });

    const wrongUnit = await send({}, { id: outsider.id, role: "SUPERVISOR", unitId: unit2.id });
    add({ group: "Floor updates", title: "Another unit's stage", setup: `A ${unit2.name} supervisor reports on a ${unit1.name} stage.`, expected: "Rejected as the wrong unit" }, { actual: describe(wrongUnit), pass: "code" in wrongUnit && wrongUnit.code === "WRONG_UNIT" });

    const future = await send({ workDate: addDays(now, 1) });
    add({ group: "Floor updates", title: "A count for tomorrow", setup: "A phone with the wrong date sends tomorrow's count.", expected: "Rejected as a future date" }, { actual: describe(future), pass: "code" in future && future.code === "FUTURE_DATE" });

    const invalid = (await service.sync([{ id: "not-a-uuid", qty: -5 }], asSupervisor))[0]!;
    add({ group: "Floor updates", title: "A garbled update", setup: "An update with a bad id and a negative count.", expected: "Rejected as invalid, the rest of the batch unaffected" }, { actual: describe(invalid), pass: "code" in invalid && invalid.code === "INVALID" });
  } finally {
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.user.deleteMany({ where: { id: { in: [supervisor.id, outsider.id] } } });
  }
  return results;
}

/** Every scenario, in order. The pure ones always run; the database ones need a merchandiser to own the throwaway order. */
export async function runScenarios(prisma: PrismaClient | null, today: () => string, merchandiserId: string | null): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of pure) {
    try {
      const check = await scenario.run();
      results.push({ group: scenario.group, title: scenario.title, setup: scenario.setup, expected: scenario.expected, ...check });
    } catch (error) {
      results.push({ group: scenario.group, title: scenario.title, setup: scenario.setup, expected: scenario.expected, actual: `error: ${String(error)}`, pass: false });
    }
  }
  if (prisma && merchandiserId) results.push(...(await databaseScenarios(prisma, today, merchandiserId)));
  return results;
}

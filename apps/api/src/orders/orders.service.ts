import { Prisma, type PrismaClient, type Stage } from "@prisma/client";
import { z } from "zod";
import { fromIso, toIso, type Clock } from "../lib/dates.js";
import { AppError, notFound } from "../lib/errors.js";
import { isoDate } from "../lib/validate.js";
import { planMilestones } from "./tna.js";
import { isShipped, loadHolidays, orderWithProgress, riskOf } from "./orderRisk.js";
import type { StageRisk } from "../risk/engine.js";

/** Stages counted in pieces. Inspection and ex-factory only happen or do not. */
const EVENT_STAGES: ReadonlySet<Stage> = new Set<Stage>(["INSPECTION", "EX_FACTORY"]);

export const createOrderSchema = z.object({
  poNumber: z.string().trim().min(1).max(40),
  buyerId: z.uuid(),
  style: z.string().trim().min(1).max(120),
  colour: z.string().trim().min(1).max(60),
  unitId: z.uuid(),
  templateId: z.uuid(),
  exFactoryDate: isoDate,
  sizes: z
    .array(z.object({ size: z.string().trim().min(1).max(20), qty: z.number().int().min(1).max(1_000_000) }))
    .min(1)
    .refine((sizes) => new Set(sizes.map((s) => s.size)).size === sizes.length, "Each size can appear once"),
  /** Stages done outside the order's own unit, such as subcontracted printing. */
  stageUnits: z
    .array(z.object({ stage: z.enum(["CUTTING", "PRINTING", "WASHING", "STITCHING", "FINISHING"]), unitId: z.uuid() }))
    .default([]),
});

export const changeDateSchema = z.object({
  date: isoDate,
  reason: z.string().trim().min(3).max(500),
});

export const boardFilterSchema = z.object({
  buyerId: z.uuid().optional(),
  unitId: z.uuid().optional(),
  /** Any date in the ship week; the week runs Monday to Sunday. */
  shipWeek: isoDate.optional(),
  status: z.enum(["RED", "AMBER", "GREEN", "NO_DATA", "NOT_STARTED", "DONE"]).optional(),
});

export function createOrdersService(prisma: PrismaClient, today: Clock) {
  async function create(input: z.infer<typeof createOrderSchema>, merchandiserId: string) {
    if (input.exFactoryDate < today()) {
      throw new AppError(400, "EX_FACTORY_IN_PAST", "The ex-factory date cannot be in the past");
    }
    const template = await prisma.tnaTemplate.findUnique({
      where: { id: input.templateId },
      include: { steps: { orderBy: { sequence: "asc" } } },
    });
    if (!template) throw notFound("Template");

    const stageUnits = new Map(input.stageUnits.map((entry) => [entry.stage as Stage, entry.unitId]));
    const totalQty = input.sizes.reduce((sum, size) => sum + size.qty, 0);
    const holidays = (await loadHolidays(prisma))(input.unitId);
    const plan = planMilestones(input.exFactoryDate, template.steps, holidays);

    try {
      return await prisma.order.create({
        data: {
          poNumber: input.poNumber,
          buyerId: input.buyerId,
          style: input.style,
          colour: input.colour,
          totalQty,
          exFactoryDate: fromIso(input.exFactoryDate),
          unitId: input.unitId,
          merchandiserId,
          templateId: template.id,
          sizes: { create: input.sizes },
          milestones: {
            create: plan.map((milestone) => ({
              stage: milestone.stage,
              sequence: milestone.sequence,
              plannedDate: fromIso(milestone.plannedDate),
              unitId: stageUnits.get(milestone.stage) ?? input.unitId,
              plannedQty: EVENT_STAGES.has(milestone.stage) ? null : totalQty,
            })),
          },
        },
        include: { milestones: { orderBy: { sequence: "asc" } }, sizes: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") throw new AppError(409, "PO_EXISTS", "This PO number already exists");
        if (error.code === "P2003") throw new AppError(400, "UNKNOWN_REFERENCE", "Buyer or unit does not exist");
      }
      throw error;
    }
  }

  async function board(filter: z.infer<typeof boardFilterSchema>) {
    const now = today();
    const week = filter.shipWeek ? weekRange(filter.shipWeek) : undefined;
    const [orders, holidaysFor] = await Promise.all([
      prisma.order.findMany({
        where: {
          buyerId: filter.buyerId,
          unitId: filter.unitId,
          exFactoryDate: week && { gte: fromIso(week.start), lte: fromIso(week.end) },
          milestones: { none: { stage: "EX_FACTORY", completedAt: { not: null } } },
        },
        include: orderWithProgress,
      }),
      loadHolidays(prisma),
    ]);

    // The newest issue that is not dismissed explains the colour on the board.
    const latestIssues = await prisma.issue.findMany({
      where: { status: { not: "DISMISSED" }, dailyUpdate: { milestone: { orderId: { in: orders.map((o) => o.id) } } } },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        aiCategory: true,
        finalCategory: true,
        dailyUpdate: { select: { milestone: { select: { orderId: true } } } },
      },
    });
    const issueByOrder = new Map<string, (typeof latestIssues)[number]>();
    for (const issue of latestIssues) {
      const orderId = issue.dailyUpdate.milestone.orderId;
      if (!issueByOrder.has(orderId)) issueByOrder.set(orderId, issue);
    }

    const items = orders.map((order) => {
      const risk = riskOf(order, now, holidaysFor(order.unitId));
      const issue = issueByOrder.get(order.id);
      return {
        id: order.id,
        poNumber: order.poNumber,
        buyer: order.buyer.name,
        style: order.style,
        colour: order.colour,
        unit: order.unit.name,
        totalQty: order.totalQty,
        exFactoryDate: toIso(order.exFactoryDate),
        status: risk.status,
        exFactoryOverdue: risk.exFactoryOverdue,
        projectedExFactory: risk.projectedExFactory,
        exFactorySlipDays: risk.exFactorySlipDays,
        focusStage: focusStage(risk.stages),
        issue: issue && {
          category: issue.finalCategory ?? issue.aiCategory,
          status: issue.status,
        },
      };
    });

    const counts = { RED: 0, AMBER: 0, GREEN: 0, NO_DATA: 0, NOT_STARTED: 0, DONE: 0 };
    for (const item of items) counts[item.status] += 1;

    const visible = filter.status ? items.filter((item) => item.status === filter.status) : items;
    visible.sort(
      (a, b) =>
        BOARD_ORDER.indexOf(a.status) - BOARD_ORDER.indexOf(b.status) ||
        a.exFactoryDate.localeCompare(b.exFactoryDate),
    );
    return { today: now, counts, orders: visible };
  }

  async function detail(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { ...orderWithProgress, sizes: true, merchandiser: { select: { name: true } } },
    });
    if (!order) throw notFound("Order");

    const holidaysFor = await loadHolidays(prisma);
    const risk = riskOf(order, today(), holidaysFor(order.unitId));
    const riskByStage = new Map(risk.stages.map((stage) => [stage.stage, stage]));
    const milestoneIds = order.milestones.map((m) => m.id);

    const [updates, issues, history] = await Promise.all([
      prisma.dailyUpdate.findMany({
        where: { milestoneId: { in: milestoneIds }, supersededAt: null },
        orderBy: [{ workDate: "desc" }, { receivedAt: "desc" }],
        take: 30,
        include: { supervisor: { select: { name: true } }, milestone: { select: { stage: true } } },
      }),
      prisma.issue.findMany({
        where: { dailyUpdate: { milestoneId: { in: milestoneIds } } },
        orderBy: { createdAt: "desc" },
        include: { dailyUpdate: { select: { workDate: true, voiceUrl: true, milestone: { select: { stage: true } } } } },
      }),
      prisma.auditLog.findMany({
        where: { entityId: { in: [order.id, ...milestoneIds] } },
        orderBy: { at: "desc" },
        include: { user: { select: { name: true } } },
      }),
    ]);

    const stageByMilestone = new Map(order.milestones.map((m) => [m.id, m.stage]));

    return {
      id: order.id,
      poNumber: order.poNumber,
      buyer: { id: order.buyerId, name: order.buyer.name },
      style: order.style,
      colour: order.colour,
      unit: order.unit.name,
      merchandiser: order.merchandiser.name,
      totalQty: order.totalQty,
      exFactoryDate: toIso(order.exFactoryDate),
      shipped: isShipped(order),
      sizes: order.sizes.map((size) => ({ size: size.size, qty: size.qty })),
      risk: {
        status: risk.status,
        exFactoryOverdue: risk.exFactoryOverdue,
        projectedExFactory: risk.projectedExFactory,
        exFactorySlipDays: risk.exFactorySlipDays,
      },
      milestones: order.milestones.map((milestone) => ({
        id: milestone.id,
        stage: milestone.stage,
        plannedDate: toIso(milestone.plannedDate),
        completedAt: milestone.completedAt && toIso(milestone.completedAt),
        plannedQty: milestone.plannedQty,
        doneQty: milestone.doneQty,
        risk: riskByStage.get(milestone.stage) ?? null,
      })),
      updates: updates.map((update) => ({
        id: update.id,
        stage: update.milestone.stage,
        workDate: toIso(update.workDate),
        qty: update.qty,
        supervisor: update.supervisor.name,
        photoUrl: update.photoUrl,
        voiceUrl: update.voiceUrl,
        note: update.noteText,
      })),
      issues: issues.map((issue) => ({
        id: issue.id,
        stage: issue.dailyUpdate.milestone.stage,
        workDate: toIso(issue.dailyUpdate.workDate),
        originalText: issue.originalText,
        translatedText: issue.translatedText,
        aiStatus: issue.aiStatus,
        aiCategory: issue.aiCategory,
        aiConfidence: issue.aiConfidence,
        finalCategory: issue.finalCategory,
        status: issue.status,
        voiceUrl: issue.dailyUpdate.voiceUrl,
      })),
      dateHistory: history.map((entry) => ({
        stage: stageByMilestone.get(entry.entityId) ?? "ORDER",
        field: entry.field,
        from: entry.oldValue,
        to: entry.newValue,
        reason: entry.reason,
        by: entry.user.name,
        at: entry.at.toISOString(),
      })),
    };
  }

  /** The change and its audit row commit together, so history cannot miss an edit. */
  async function changeMilestoneDate(id: string, input: z.infer<typeof changeDateSchema>, userId: string) {
    const milestone = await prisma.milestone.findUnique({ where: { id }, include: { order: true } });
    if (!milestone) throw notFound("Milestone");
    if (milestone.stage === "EX_FACTORY") {
      throw new AppError(400, "USE_EX_FACTORY_CHANGE", "Change the ex-factory date on the order itself");
    }
    if (input.date > toIso(milestone.order.exFactoryDate)) {
      throw new AppError(400, "AFTER_EX_FACTORY", "A milestone cannot fall after the ex-factory date");
    }
    const oldDate = toIso(milestone.plannedDate);
    if (oldDate === input.date) throw new AppError(400, "DATE_UNCHANGED", "This is already the planned date");

    await prisma.$transaction([
      prisma.milestone.update({ where: { id }, data: { plannedDate: fromIso(input.date) } }),
      prisma.auditLog.create({
        data: {
          entity: "Milestone",
          entityId: id,
          field: "plannedDate",
          oldValue: oldDate,
          newValue: input.date,
          reason: input.reason,
          userId,
        },
      }),
    ]);
  }

  async function changeExFactoryDate(id: string, input: z.infer<typeof changeDateSchema>, userId: string) {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw notFound("Order");
    if (input.date < today()) throw new AppError(400, "EX_FACTORY_IN_PAST", "The ex-factory date cannot be in the past");
    const oldDate = toIso(order.exFactoryDate);
    if (oldDate === input.date) throw new AppError(400, "DATE_UNCHANGED", "This is already the ex-factory date");

    await prisma.$transaction([
      prisma.order.update({ where: { id }, data: { exFactoryDate: fromIso(input.date) } }),
      prisma.milestone.updateMany({
        where: { orderId: id, stage: "EX_FACTORY" },
        data: { plannedDate: fromIso(input.date) },
      }),
      prisma.auditLog.create({
        data: {
          entity: "Order",
          entityId: id,
          field: "exFactoryDate",
          oldValue: oldDate,
          newValue: input.date,
          reason: input.reason,
          userId,
        },
      }),
    ]);
  }

  /** Marks inspection as passed or the order as shipped. Quantity stages complete from their numbers. */
  async function completeEvent(id: string) {
    const milestone = await prisma.milestone.findUnique({
      where: { id },
      include: { order: { include: { milestones: true } } },
    });
    if (!milestone) throw notFound("Milestone");
    if (!EVENT_STAGES.has(milestone.stage)) {
      throw new AppError(400, "QUANTITY_STAGE", "This stage completes from its daily numbers");
    }
    const unfinished = milestone.order.milestones.filter(
      (m) => m.plannedQty !== null && m.doneQty < m.plannedQty,
    );
    if (unfinished.length > 0) {
      throw new AppError(409, "STAGES_UNFINISHED", "Earlier stages still have pieces left", {
        stages: unfinished.map((m) => m.stage),
      });
    }
    await prisma.milestone.update({ where: { id }, data: { completedAt: fromIso(today()) } });
  }

  return { create, board, detail, changeMilestoneDate, changeExFactoryDate, completeEvent };
}

const BOARD_ORDER = ["RED", "AMBER", "NO_DATA", "GREEN", "NOT_STARTED", "DONE"] as const;

/** The stage to show on the board: the most urgent one that is under way. */
function focusStage(stages: readonly StageRisk[]): StageRisk | null {
  for (const status of BOARD_ORDER.slice(0, 4)) {
    const stage = stages.find((candidate) => candidate.status === status);
    if (stage) return stage;
  }
  return null;
}

function weekRange(date: string): { start: string; end: string } {
  const day = fromIso(date);
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  const start = new Date(day.getTime() - daysSinceMonday * 86_400_000);
  return { start: toIso(start), end: toIso(new Date(start.getTime() + 6 * 86_400_000)) };
}

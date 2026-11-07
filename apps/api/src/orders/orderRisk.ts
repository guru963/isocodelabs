import type { Prisma, PrismaClient } from "@prisma/client";
import { toIso } from "../lib/dates.js";
import type { IsoDate } from "../risk/calendar.js";
import { computeOrderRisk, type OrderRisk, type StageInput } from "../risk/engine.js";

/** The rows the risk engine needs. Superseded updates never count. */
export const orderWithProgress = {
  buyer: true,
  unit: true,
  milestones: {
    orderBy: { sequence: "asc" },
    include: {
      updates: {
        where: { supersededAt: null },
        select: { workDate: true, qty: true },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithProgress = Prisma.OrderGetPayload<{ include: typeof orderWithProgress }>;

export const isShipped = (order: Pick<OrderWithProgress, "milestones">): boolean =>
  order.milestones.some((m) => m.stage === "EX_FACTORY" && m.completedAt !== null);

/** Converts database rows to engine input. Risk is calculated here on every read, never stored. */
export function riskOf(order: OrderWithProgress, today: IsoDate, holidays: ReadonlySet<IsoDate>): OrderRisk {
  const quantityMilestones = order.milestones.filter((m) => m.plannedQty !== null);
  const stages: StageInput[] = quantityMilestones.map((milestone, index) => {
    const previous = quantityMilestones[index - 1];
    return {
      stage: milestone.stage,
      plannedQty: milestone.plannedQty ?? 0,
      doneQty: milestone.doneQty,
      milestoneDate: toIso(milestone.plannedDate),
      previousMilestoneDate: previous && toIso(previous.plannedDate),
      outputs: milestone.updates.map((update) => ({ date: toIso(update.workDate), qty: update.qty })),
    };
  });
  return computeOrderRisk(
    { exFactoryDate: toIso(order.exFactoryDate), stages, shipped: isShipped(order) },
    { today, holidays },
  );
}

export type HolidaysFor = (unitId: string) => ReadonlySet<IsoDate>;

/** Company-wide holidays apply to every unit; the rest apply only to their own. */
export async function loadHolidays(prisma: PrismaClient): Promise<HolidaysFor> {
  const rows = await prisma.holiday.findMany();
  return (unitId) =>
    new Set(
      rows
        .filter((holiday) => holiday.unitId === null || holiday.unitId === unitId)
        .map((holiday) => toIso(holiday.date)),
    );
}

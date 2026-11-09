import type { PrismaClient, Stage } from "@prisma/client";
import { fromIso, toIso } from "../lib/dates.js";
import { dateInIndia, missedOnDay } from "../notifications/rules.js";
import { addDays, workingDayOnOrBefore, type IsoDate } from "../risk/calendar.js";

/** The working day before `date`. Supervisors may add that day's count late, and no earlier one. */
export const previousWorkingDay = (date: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate =>
  workingDayOnOrBefore(addDays(date, -1), holidays);

export interface MissedStage {
  milestoneId: string;
  stage: Stage;
  unitId: string;
  orderId: string;
  poNumber: string;
}

/** The counted stages at a unit, of unshipped orders, that should have had a count on `date` and did not. */
export async function stagesMissedOn(prisma: PrismaClient, date: IsoDate, unitId?: string): Promise<MissedStage[]> {
  const day = fromIso(date);
  const milestones = await prisma.milestone.findMany({
    where: {
      unitId,
      plannedQty: { not: null },
      order: { milestones: { none: { stage: "EX_FACTORY", completedAt: { not: null } } } },
    },
    include: {
      order: {
        select: {
          id: true,
          poNumber: true,
          createdAt: true,
          milestones: { where: { plannedQty: { not: null } }, select: { sequence: true, completedAt: true } },
        },
      },
      updates: { where: { supersededAt: null, workDate: { lte: day } }, select: { workDate: true } },
    },
  });

  return milestones
    .filter((milestone) => {
      const earlier = milestone.order.milestones
        .filter((other) => other.sequence < milestone.sequence)
        .sort((a, b) => b.sequence - a.sequence);
      const previous = earlier[0];
      return missedOnDay({
        orderExistedBefore: dateInIndia(milestone.order.createdAt) < date,
        firstStage: earlier.length === 0,
        previousFinishedBefore: previous?.completedAt != null && toIso(previous.completedAt) < date,
        countedBefore: milestone.updates.some((update) => toIso(update.workDate) < date),
        finishedBefore: milestone.completedAt !== null && toIso(milestone.completedAt) < date,
        countedOnDay: milestone.updates.some((update) => toIso(update.workDate) === date),
      });
    })
    .map((milestone) => ({
      milestoneId: milestone.id,
      stage: milestone.stage,
      unitId: milestone.unitId,
      orderId: milestone.order.id,
      poNumber: milestone.order.poNumber,
    }));
}

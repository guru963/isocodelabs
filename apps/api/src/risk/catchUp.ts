import { addDays, countWorkingDays, isWorkingDay, type IsoDate } from "./calendar.js";
import type { StageRisk } from "./engine.js";

/** The milestone after a late stage: the one that gives up time if the late stage's deadline moves. */
export interface NextMilestone {
  stage: string;
  plannedDate: IsoDate;
}

export interface CatchUpPlan {
  stage: string;
  milestoneDate: IsoDate;
  projectedDate: IsoDate;
  slipDays: number;
  /** Make more each day from tomorrow. Null once the milestone has passed and no day is left. */
  raiseOutput: { perDay: number; currentPerDay: number; increasePercent: number } | null;
  /**
   * Work days the factory normally has off (Sundays and holidays) before the milestone, at the
   * current pace. `dates` are the earliest such days; `shortByDays` is what is still missing
   * when every one of them is worked.
   */
  extraDays: { dates: IsoDate[]; enough: boolean; shortByDays: number };
  /**
   * Let this stage finish on its projected date and take the time from the next milestone.
   * `nextKeepsWorkingDays` is what the next stage keeps of the `nextHadWorkingDays` it planned.
   */
  moveDeadline: {
    to: IsoDate;
    nextStage: string;
    nextDate: IsoDate;
    nextHadWorkingDays: number;
    nextKeepsWorkingDays: number;
    feasible: boolean;
  } | null;
}

/**
 * Assumption, labelled in the TDD: a stage must keep at least one working day of its own, so
 * a deadline can only move forward while the next stage is left that much.
 */
export const MIN_NEXT_STAGE_WORKING_DAYS = 1;

/** Sundays and holidays strictly after `after`, up to and including `through`, earliest first. */
function daysOff(after: IsoDate, through: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate[] {
  const days: IsoDate[] = [];
  for (let day = addDays(after, 1); day <= through; day = addDays(day, 1)) {
    if (!isWorkingDay(day, holidays)) days.push(day);
  }
  return days;
}

/**
 * Three ways to bring a late stage back on plan, worked out from the same figures as the
 * warning itself: make more each day, work days normally off, or move the deadline into the
 * next stage's time. Null when the stage is not late, or its pace is unknown or zero, because
 * then there is nothing reliable to plan from.
 */
export function planCatchUp(
  risk: StageRisk,
  holidays: ReadonlySet<IsoDate>,
  next: NextMilestone | null,
): CatchUpPlan | null {
  const { actualPerDay, projectedDate, slipDays } = risk;
  if (risk.status === "DONE" || !actualPerDay || !projectedDate || slipDays === null || slipDays <= 0) return null;

  const raiseOutput =
    risk.neededPerDay === null
      ? null
      : {
          perDay: risk.neededPerDay,
          currentPerDay: actualPerDay,
          increasePercent: Math.round((risk.neededPerDay / actualPerDay - 1) * 100),
        };

  // At today's pace the stage needs this many working days; the milestone allows fewer.
  const daysNeeded = Math.ceil(risk.remainingQty / actualPerDay);
  const missing = Math.max(daysNeeded - risk.workingDaysLeft, 0);
  const off = daysOff(risk.countedThrough, risk.milestoneDate, holidays);
  const extraDays = {
    dates: off.slice(0, missing),
    enough: off.length >= missing,
    shortByDays: Math.max(missing - off.length, 0),
  };

  let moveDeadline: CatchUpPlan["moveDeadline"] = null;
  if (next) {
    const had = countWorkingDays(risk.milestoneDate, next.plannedDate, holidays);
    const keeps = projectedDate < next.plannedDate ? countWorkingDays(projectedDate, next.plannedDate, holidays) : 0;
    moveDeadline = {
      to: projectedDate,
      nextStage: next.stage,
      nextDate: next.plannedDate,
      nextHadWorkingDays: had,
      nextKeepsWorkingDays: keeps,
      feasible: keeps >= MIN_NEXT_STAGE_WORKING_DAYS,
    };
  }

  return {
    stage: risk.stage,
    milestoneDate: risk.milestoneDate,
    projectedDate,
    slipDays,
    raiseOutput,
    extraDays,
    moveDeadline,
  };
}

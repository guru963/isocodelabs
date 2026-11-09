import { addDays, addWorkingDays, countWorkingDays, diffDays, isWorkingDay, type IsoDate } from "./calendar.js";
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
  /**
   * Make more each day from tomorrow. Null once the milestone has passed and no day is left.
   * `realistic` is false when the increase is beyond what a line can usually stretch to.
   */
  raiseOutput: { perDay: number; currentPerDay: number; increasePercent: number; realistic: boolean } | null;
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
  /**
   * Only when no single option above recovers the stage: the best the line can do with every
   * lever at once, and, if even that is late, the earliest ex-factory date to agree with the buyer.
   */
  lastResort: LastResort | null;
}

export interface LastResort {
  /** All levers together: a stretched daily output and the days off it needs. */
  combined: { perDay: number; increasePercent: number; dates: IsoDate[]; finishes: IsoDate; slipDays: number; recovers: boolean };
  /** The order's agreed ex-factory date, and the earliest realistic one when the combination is still late. */
  exFactoryDate: IsoDate | null;
  newExFactory: IsoDate | null;
}

/**
 * Assumption, labelled in the TDD: a stage must keep at least one working day of its own, so
 * a deadline can only move forward while the next stage is left that much.
 */
export const MIN_NEXT_STAGE_WORKING_DAYS = 1;

/**
 * Assumption, labelled in the TDD: the most a line can usually raise its daily output for a
 * short spell, with overtime or an extra operator, before quality suffers. Beyond it, a higher
 * daily figure is not offered as a plan.
 */
export const MAX_STRETCH_PERCENT = 25;

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
  /** The order's agreed ex-factory date, for the last resort's new date. */
  exFactoryDate: IsoDate | null = null,
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
          realistic: risk.neededPerDay <= actualPerDay * (1 + MAX_STRETCH_PERCENT / 100),
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

  const singleRecovers = Boolean(raiseOutput?.realistic) || extraDays.enough || Boolean(moveDeadline?.feasible);

  return {
    stage: risk.stage,
    milestoneDate: risk.milestoneDate,
    projectedDate,
    slipDays,
    raiseOutput,
    extraDays,
    moveDeadline,
    lastResort: singleRecovers ? null : lastResortFor(risk, actualPerDay, off, holidays, exFactoryDate),
  };
}

/**
 * Every lever at once: the stretched daily output, then the days off before the milestone, as
 * many as it takes. If that still ends late, the later stages keep their planned length, as in
 * the delay projection, which gives the earliest ex-factory date the factory can honestly offer.
 */
function lastResortFor(
  risk: StageRisk,
  actualPerDay: number,
  off: IsoDate[],
  holidays: ReadonlySet<IsoDate>,
  exFactoryDate: IsoDate | null,
): LastResort {
  const perDay = Math.floor(actualPerDay * (1 + MAX_STRETCH_PERCENT / 100));
  const daysNeeded = Math.ceil(risk.remainingQty / perDay);
  const extra = Math.max(daysNeeded - risk.workingDaysLeft, 0);
  const dates = off.slice(0, extra);
  // Enough days off before the milestone: it ends on time. Otherwise every one of them counts as a
  // production day, and the rest of the work falls on the working days after.
  const finishes =
    extra <= off.length ? risk.milestoneDate : addWorkingDays(risk.countedThrough, daysNeeded - off.length, holidays);
  const slipDays = Math.max(diffDays(risk.milestoneDate, finishes), 0);
  const recovers = slipDays === 0;

  let newExFactory: IsoDate | null = null;
  if (!recovers && exFactoryDate) {
    const gap = countWorkingDays(risk.milestoneDate, exFactoryDate, holidays);
    const pushed = addWorkingDays(finishes, gap, holidays);
    newExFactory = pushed > exFactoryDate ? pushed : null;
  }

  return {
    combined: {
      perDay,
      increasePercent: Math.round((perDay / actualPerDay - 1) * 100),
      dates: extra <= off.length ? dates : off,
      finishes,
      slipDays,
      recovers,
    },
    exFactoryDate,
    newExFactory,
  };
}

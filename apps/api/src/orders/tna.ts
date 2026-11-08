import { addDays, workingDayOnOrBefore, type IsoDate } from "../risk/calendar.js";

export interface TemplateStep<Stage extends string = string> {
  stage: Stage;
  daysBeforeExFactory: number;
}

export interface PlannedMilestone<Stage extends string = string> {
  stage: Stage;
  sequence: number;
  plannedDate: IsoDate;
}

/**
 * Works back from the ex-factory date. A date landing on a Sunday or holiday moves
 * earlier, because moving it later would eat into the next stage's time.
 */
export function planMilestones<Stage extends string>(
  exFactoryDate: IsoDate,
  steps: readonly TemplateStep<Stage>[],
  holidays: ReadonlySet<IsoDate>,
): PlannedMilestone<Stage>[] {
  return steps.map((step, index) => ({
    stage: step.stage,
    sequence: index + 1,
    plannedDate: workingDayOnOrBefore(addDays(exFactoryDate, -step.daysBeforeExFactory), holidays),
  }));
}

/**
 * The first ex-factory date that leaves the template its full lead time: every stage of
 * its plan falls on or after today. Earlier dates still save, but the order starts behind.
 */
export function earliestExFactory<Stage extends string>(
  today: IsoDate,
  steps: readonly TemplateStep<Stage>[],
  holidays: ReadonlySet<IsoDate>,
): IsoDate {
  const lead = Math.max(0, ...steps.map((step) => step.daysBeforeExFactory));
  let candidate = addDays(today, lead);
  // A Sunday or holiday can pull a stage a day or two earlier, so step forward until none lands in the past.
  for (let tries = 0; tries < 60; tries += 1) {
    if (planMilestones(candidate, steps, holidays).every((step) => step.plannedDate >= today)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

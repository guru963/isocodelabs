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

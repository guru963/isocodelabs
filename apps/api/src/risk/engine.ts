import {
  addDays,
  addWorkingDays,
  countWorkingDays,
  diffDays,
  type IsoDate,
} from "./calendar.js";

export type RiskStatus = "GREEN" | "AMBER" | "RED" | "NO_DATA" | "NOT_STARTED" | "DONE";

export type RiskFlag =
  /** The rate comes from fewer reported days than the window asks for. */
  | "LOW_CONFIDENCE"
  /** Supervisors have reported, but nothing was made across the rate window. */
  | "NO_OUTPUT"
  /** The stage milestone has passed with pieces still to make. */
  | "MILESTONE_PASSED"
  /** No report for several working days, so the rate may be out of date. */
  | "STALE_DATA";

/** Assumptions, labelled in the TDD. Kept together so the client can tune them. */
export interface RiskConfig {
  /** Reported days averaged to get the current rate. */
  rateWindowDays: number;
  /** Calendar days late at which a stage turns amber. */
  amberFromDays: number;
  /** Calendar days late at which a stage turns red. */
  redFromDays: number;
  /** Working days without a report before data counts as stale. */
  staleAfterWorkingDays: number;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  rateWindowDays: 3,
  amberFromDays: 1,
  redFromDays: 3,
  staleAfterWorkingDays: 3,
};

export interface DailyOutput {
  date: IsoDate;
  qty: number;
}

export interface StageInput {
  stage: string;
  plannedQty: number;
  doneQty: number;
  milestoneDate: IsoDate;
  /** The previous stage's milestone: this stage is not expected to report before it. */
  previousMilestoneDate?: IsoDate;
  outputs: readonly DailyOutput[];
}

export interface RiskContext {
  today: IsoDate;
  holidays: ReadonlySet<IsoDate>;
  config?: RiskConfig;
}

export interface StageRisk {
  stage: string;
  status: RiskStatus;
  flags: RiskFlag[];
  milestoneDate: IsoDate;
  remainingQty: number;
  workingDaysLeft: number;
  /** Null when no working days remain, so no daily rate can meet the milestone. */
  neededPerDay: number | null;
  /** Null when there is no reported output to average. */
  actualPerDay: number | null;
  /** Extra pieces a day needed to catch up; 0 when on pace. */
  shortfallPerDay: number;
  /** Null when output is zero or unknown, so no finish date can be projected. */
  projectedDate: IsoDate | null;
  /** Calendar days past the milestone; negative when ahead of plan. */
  slipDays: number | null;
}

/** Totals per reported date, newest first. Two supervisors can report one stage. */
function reportedDays(outputs: readonly DailyOutput[], today: IsoDate): DailyOutput[] {
  const totals = new Map<IsoDate, number>();
  for (const { date, qty } of outputs) {
    if (date <= today) totals.set(date, (totals.get(date) ?? 0) + qty);
  }
  return [...totals]
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function computeStageRisk(input: StageInput, context: RiskContext): StageRisk {
  const { today, holidays, config = DEFAULT_RISK_CONFIG } = context;
  const remainingQty = Math.max(input.plannedQty - input.doneQty, 0);
  const days = reportedDays(input.outputs, today);
  const latest = days[0];

  const result: StageRisk = {
    stage: input.stage,
    status: "NO_DATA",
    flags: [],
    milestoneDate: input.milestoneDate,
    remainingQty,
    workingDaysLeft: 0,
    neededPerDay: null,
    actualPerDay: null,
    shortfallPerDay: 0,
    projectedDate: null,
    slipDays: null,
  };

  if (remainingQty === 0) return { ...result, status: "DONE" };

  // Once today's number is in, today's work is over and the plan starts tomorrow.
  const lastCountedDay = latest?.date === today ? today : addDays(today, -1);
  const workingDaysLeft = countWorkingDays(lastCountedDay, input.milestoneDate, holidays);
  const neededPerDay = workingDaysLeft > 0 ? Math.ceil(remainingQty / workingDaysLeft) : null;
  const milestonePassed = today > input.milestoneDate;
  const flags: RiskFlag[] = milestonePassed ? ["MILESTONE_PASSED"] : [];

  const planned = { ...result, workingDaysLeft, neededPerDay, flags };

  if (!latest) {
    if (milestonePassed) return { ...planned, status: "RED" };
    const notDue = input.previousMilestoneDate && today <= input.previousMilestoneDate;
    return { ...planned, status: notDue && input.doneQty === 0 ? "NOT_STARTED" : "NO_DATA" };
  }

  const stale = countWorkingDays(latest.date, today, holidays) >= config.staleAfterWorkingDays;
  if (stale) flags.push("STALE_DATA");

  const window = days.slice(0, config.rateWindowDays);
  if (window.length < config.rateWindowDays) flags.push("LOW_CONFIDENCE");
  const rate = window.reduce((sum, day) => sum + day.qty, 0) / window.length;

  if (rate === 0) {
    flags.push("NO_OUTPUT");
    return { ...planned, status: "RED", actualPerDay: 0, shortfallPerDay: neededPerDay ?? 0 };
  }

  const projectedDate = addWorkingDays(lastCountedDay, Math.ceil(remainingQty / rate), holidays);
  const slipDays = diffDays(input.milestoneDate, projectedDate);
  const actualPerDay = Math.round(rate);

  let status: RiskStatus = "GREEN";
  if (milestonePassed || slipDays >= config.redFromDays) status = "RED";
  else if (slipDays >= config.amberFromDays || stale) status = "AMBER";

  return {
    ...planned,
    status,
    actualPerDay,
    shortfallPerDay: Math.max((neededPerDay ?? 0) - actualPerDay, 0),
    projectedDate,
    slipDays,
  };
}

export interface OrderInput {
  exFactoryDate: IsoDate;
  /** Quantity stages in production order. */
  stages: readonly StageInput[];
  shipped?: boolean;
}

export interface OrderRisk {
  status: RiskStatus;
  stages: StageRisk[];
  /** Null when no in-progress stage can be projected. */
  projectedExFactory: IsoDate | null;
  exFactorySlipDays: number | null;
  /** The ex-factory date has passed and the order has not shipped. */
  exFactoryOverdue: boolean;
}

/** Most urgent first. NO_DATA outranks GREEN so that silence never looks healthy. */
const SEVERITY: readonly RiskStatus[] = ["RED", "AMBER", "NO_DATA", "GREEN", "NOT_STARTED", "DONE"];

function overallStatus(stages: readonly StageRisk[]): RiskStatus {
  const present = new Set(stages.map((stage) => stage.status));
  return SEVERITY.find((status) => present.has(status)) ?? "NO_DATA";
}

export function computeOrderRisk(order: OrderInput, context: RiskContext): OrderRisk {
  const stages = order.stages.map((stage) => computeStageRisk(stage, context));

  // A late stage pushes everything after it. Assumption: later stages keep their
  // planned length, so the warning shows the slip before anyone compresses them.
  let projectedExFactory: IsoDate | null = null;
  for (const stage of stages) {
    if (!stage.projectedDate) continue;
    const gap = countWorkingDays(stage.milestoneDate, order.exFactoryDate, context.holidays);
    const pushed = addWorkingDays(stage.projectedDate, gap, context.holidays);
    if (!projectedExFactory || pushed > projectedExFactory) projectedExFactory = pushed;
  }

  // Finishing every stage does not ship the order, so a missed date stays red.
  const exFactoryOverdue = !order.shipped && context.today > order.exFactoryDate;

  return {
    status: order.shipped ? "DONE" : exFactoryOverdue ? "RED" : overallStatus(stages),
    stages,
    projectedExFactory,
    exFactorySlipDays: projectedExFactory ? diffDays(order.exFactoryDate, projectedExFactory) : null,
    exFactoryOverdue,
  };
}

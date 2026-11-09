export type Role = "MERCHANDISER" | "SUPERVISOR";
export type RiskStatus = "RED" | "AMBER" | "GREEN" | "NO_DATA" | "NOT_STARTED" | "DONE";
export type Stage = "CUTTING" | "PRINTING" | "WASHING" | "STITCHING" | "FINISHING" | "INSPECTION" | "EX_FACTORY";
export type IssueCategory =
  | "POWER_CUT"
  | "MACHINE_BREAKDOWN"
  | "WORKER_ABSENCE"
  | "FABRIC_DELAY"
  | "SUBCONTRACTOR_DELAY"
  | "QUALITY_REWORK"
  | "TRIMS_SHORTAGE"
  | "OTHER";
export type IssueStatus = "PENDING" | "CONFIRMED" | "DISMISSED";
export type AiStatus = "PENDING" | "COMPLETED" | "FAILED";
export type RiskFlag = "LOW_CONFIDENCE" | "NO_OUTPUT" | "MILESTONE_PASSED" | "STALE_DATA";

export interface User {
  id: string;
  name: string;
  role: Role;
  unitId: string | null;
  language: string;
}

export interface StageRisk {
  stage: Stage;
  status: RiskStatus;
  flags: RiskFlag[];
  milestoneDate: string;
  remainingQty: number;
  workingDaysLeft: number;
  neededPerDay: number | null;
  actualPerDay: number | null;
  shortfallPerDay: number;
  projectedDate: string | null;
  slipDays: number | null;
}

/** Three ways to bring a late stage back on plan, worked out by the API from the same figures. */
export interface CatchUpPlan {
  stage: Stage;
  milestoneDate: string;
  projectedDate: string;
  slipDays: number;
  raiseOutput: { perDay: number; currentPerDay: number; increasePercent: number; realistic: boolean } | null;
  extraDays: { dates: string[]; enough: boolean; shortByDays: number };
  moveDeadline: {
    to: string;
    nextStage: Stage;
    nextDate: string;
    nextHadWorkingDays: number;
    nextKeepsWorkingDays: number;
    feasible: boolean;
  } | null;
  /** Only when no single option recovers the stage. */
  lastResort: {
    combined: { perDay: number; increasePercent: number; dates: string[]; finishes: string; slipDays: number; recovers: boolean };
    exFactoryDate: string | null;
    newExFactory: string | null;
  } | null;
}

export interface BuyerMessageDraft {
  subject: string;
  body: string;
  source: "ai" | "template";
}

export interface BoardOrder {
  id: string;
  poNumber: string;
  buyer: string;
  style: string;
  colour: string;
  unit: string;
  totalQty: number;
  exFactoryDate: string;
  status: RiskStatus;
  exFactoryOverdue: boolean;
  projectedExFactory: string | null;
  exFactorySlipDays: number | null;
  focusStage: StageRisk | null;
  issue?: { category: IssueCategory | null; status: IssueStatus };
}

export interface Board {
  today: string;
  counts: Record<RiskStatus, number>;
  orders: BoardOrder[];
}

export interface Reference {
  buyers: { id: string; name: string; country: string }[];
  units: { id: string; name: string; type: "OWN" | "SUBCONTRACT" }[];
  templates: {
    id: string;
    name: string;
    steps: { stage: Stage; sequence: number; daysBeforeExFactory: number }[];
  }[];
}

export interface OrderDetail {
  today: string;
  id: string;
  poNumber: string;
  buyer: { id: string; name: string };
  style: string;
  colour: string;
  unit: string;
  merchandiser: string;
  totalQty: number;
  exFactoryDate: string;
  shipped: boolean;
  sizes: { size: string; qty: number }[];
  risk: {
    status: RiskStatus;
    exFactoryOverdue: boolean;
    projectedExFactory: string | null;
    exFactorySlipDays: number | null;
  };
  milestones: {
    id: string;
    stage: Stage;
    plannedDate: string;
    completedAt: string | null;
    plannedQty: number | null;
    doneQty: number;
    risk: StageRisk | null;
    catchUp: CatchUpPlan | null;
  }[];
  updates: {
    id: string;
    stage: Stage;
    workDate: string;
    qty: number;
    supervisor: string;
    photoUrl: string | null;
    voiceUrl: string | null;
    note: string | null;
    /** Typed on a later day than the one it counts for. */
    enteredLate: boolean;
  }[];
  issues: {
    id: string;
    stage: Stage;
    workDate: string;
    originalText: string;
    translatedText: string | null;
    aiStatus: AiStatus;
    aiCategory: IssueCategory | null;
    aiConfidence: number | null;
    finalCategory: IssueCategory | null;
    status: IssueStatus;
    voiceUrl: string | null;
  }[];
  dateHistory: {
    stage: Stage | "ORDER";
    field: string;
    from: string | null;
    to: string | null;
    reason: string;
    by: string;
    at: string;
  }[];
}

export interface Issue {
  id: string;
  status: IssueStatus;
  originalText: string;
  translatedText: string | null;
  aiStatus: AiStatus;
  aiError: string | null;
  aiCategory: IssueCategory | null;
  aiConfidence: number | null;
  finalCategory: IssueCategory | null;
  needsReview: boolean;
  stage: Stage;
  order: { id: string; poNumber: string; style: string; colour: string; buyer: { name: string } };
  workDate: string;
  supervisor: string;
  voiceUrl: string | null;
  photoUrl: string | null;
}

export interface WorklistStage {
  milestoneId: string;
  stage: Stage;
  poNumber: string;
  style: string;
  colour: string;
  plannedQty: number;
  doneQty: number;
  plannedDate: string;
  todayQty: number | null;
  /** The last working day, when this stage had no count then. The supervisor can still add it. */
  missedDate: string | null;
}

export interface Worklist {
  today: string;
  stages: WorklistStage[];
}

export type BuyerProgress = "SHIPPED" | "IN_PROGRESS" | "SLIGHT_DELAY" | "DELAYED";

export interface BuyerOrder {
  id: string;
  poNumber: string;
  style: string;
  colour: string;
  totalQty: number;
  exFactoryDate: string;
  progress: BuyerProgress;
  reason: string | null;
  milestones: {
    stage: Stage;
    plannedDate: string;
    completedOn: string | null;
    percentDone: number | null;
  }[];
  photos: { url: string; stage: Stage; date: string }[];
}

export interface BuyerOrderDetail extends BuyerOrder {
  dateHistory: { stage: Stage; from: string | null; to: string | null; reason: string; at: string }[];
}

import type { IssueCategory, RiskStatus, Stage } from "./types";

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO dates are calendar days, so they are always read in UTC and never shift by time zone. */
export const shortDate = (iso: string): string => dateFormat.format(new Date(`${iso}T00:00:00Z`));
export const fullDate = (iso: string): string => fullDateFormat.format(new Date(`${iso}T00:00:00Z`));
export const dateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));
export const pieces = (qty: number): string => qty.toLocaleString("en-IN");

export const days = (count: number): string => `${count} ${Math.abs(count) === 1 ? "day" : "days"}`;

export const STAGE_LABEL: Record<Stage, string> = {
  CUTTING: "Cutting",
  PRINTING: "Printing",
  WASHING: "Washing",
  STITCHING: "Stitching",
  FINISHING: "Finishing",
  INSPECTION: "Inspection",
  EX_FACTORY: "Ex-factory",
};

export const STATUS_LABEL: Record<RiskStatus, string> = {
  RED: "Delayed",
  AMBER: "At risk",
  GREEN: "On track",
  NO_DATA: "No reports",
  NOT_STARTED: "Not started",
  DONE: "Done",
};

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  POWER_CUT: "Power cut",
  MACHINE_BREAKDOWN: "Machine breakdown",
  WORKER_ABSENCE: "Worker absence",
  FABRIC_DELAY: "Fabric delay",
  SUBCONTRACTOR_DELAY: "Subcontractor delay",
  QUALITY_REWORK: "Quality rework",
  TRIMS_SHORTAGE: "Trims shortage",
  OTHER: "Other",
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as IssueCategory[];

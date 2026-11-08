import type { Stage } from "@prisma/client";

/** Supervisors get Tamil by default. Wording is an assumption, to be checked by a native speaker. */
const STAGE_NAMES: Record<"en" | "ta", Record<Stage, string>> = {
  en: {
    CUTTING: "Cutting",
    PRINTING: "Printing",
    WASHING: "Washing",
    STITCHING: "Stitching",
    FINISHING: "Finishing",
    INSPECTION: "Inspection",
    EX_FACTORY: "Ex-factory",
  },
  ta: {
    CUTTING: "கட்டிங்",
    PRINTING: "பிரிண்டிங்",
    WASHING: "வாஷிங்",
    STITCHING: "தையல்",
    FINISHING: "ஃபினிஷிங்",
    INSPECTION: "ஆய்வு",
    EX_FACTORY: "அனுப்புதல்",
  },
};

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const shortDay = (iso: string): string => dayFormat.format(new Date(`${iso}T00:00:00Z`));

export interface MissedLine {
  stage: Stage;
  poNumber: string;
}

const language = (value: string) => (value === "ta" ? "ta" : "en");

export function missedCountMessage(lang: string, date: string, stages: readonly MissedLine[]) {
  const l = language(lang);
  const list = stages.map((s) => `${STAGE_NAMES[l][s.stage]} (${s.poNumber})`).join(", ");
  return l === "ta"
    ? {
        title: "இன்றைய எண்ணிக்கை பதிவாகவில்லை",
        body: `${list}: ${shortDay(date)} எண்ணிக்கை இன்னும் பதிவு செய்யப்படவில்லை. வெளியேறும் முன் பதிவு செய்யவும்.`,
      }
    : {
        title: "Today's count is missing",
        body: `${list}: no count yet for ${shortDay(date)}. Please enter it before you leave.`,
      };
}

export function escalationMessage(date: string, lines: readonly (MissedLine & { unit: string })[]) {
  const list = lines.map((s) => `${s.unit}, ${STAGE_NAMES.en[s.stage]} for ${s.poNumber}`).join("; ");
  return {
    title: `Counts missing from ${shortDay(date)}`,
    body: `No count was entered for: ${list}. Their pace may be out of date.`,
  };
}

export function noteWaitingMessage(stage: Stage, poNumber: string, text: string) {
  const excerpt = text.length > 90 ? `${text.slice(0, 87)}...` : text;
  return {
    title: "A note is waiting for review",
    body: `${STAGE_NAMES.en[stage]}, ${poNumber}: ${excerpt || "a voice note"}`,
  };
}

export function orderRedMessage(
  poNumber: string,
  exFactory: string,
  projected: string | null,
  slipDays: number | null,
  overdue = false,
) {
  return {
    title: `${poNumber} is now delayed`,
    body: overdue
      ? `Its ex-factory date of ${shortDay(exFactory)} has passed and it has not shipped.`
      : projected && slipDays !== null && slipDays > 0
        ? `At the current pace it reaches ex-factory on ${shortDay(projected)}, ${slipDays} ${slipDays === 1 ? "day" : "days"} after ${shortDay(exFactory)}.`
        : `It is behind plan for its ex-factory date of ${shortDay(exFactory)}.`,
  };
}

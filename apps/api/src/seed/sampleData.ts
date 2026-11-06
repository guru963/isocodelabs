/**
 * From the problem statement: PO number, buyer, style, total quantity, ex-factory
 * date, current stage and quantity done.
 *
 * ASSUMPTIONS, labelled in the TDD: templates and their day offsets, size splits,
 * units, people, daily figures and notes. Daily figures add up to the statement's
 * quantity done, and are chosen so the board opens with one red, amber and green.
 */
import { addDays, addWorkingDays, isWorkingDay, type IsoDate } from "../risk/calendar.js";
import type { TemplateStep } from "../orders/tna.js";

export type SeedStage =
  | "CUTTING"
  | "PRINTING"
  | "STITCHING"
  | "FINISHING"
  | "INSPECTION"
  | "EX_FACTORY";

export type SeedCategory = "MACHINE_BREAKDOWN" | "TRIMS_SHORTAGE";

export const DEMO_TODAY: IsoDate = "2026-11-06";
export const NO_HOLIDAYS: ReadonlySet<IsoDate> = new Set();

const QUANTITY_STAGES: ReadonlySet<SeedStage> = new Set([
  "CUTTING",
  "PRINTING",
  "STITCHING",
  "FINISHING",
]);

export const isQuantityStage = (stage: SeedStage): boolean => QUANTITY_STAGES.has(stage);

export const TEMPLATES = {
  "Plain knit": [
    { stage: "CUTTING", daysBeforeExFactory: 18 },
    { stage: "STITCHING", daysBeforeExFactory: 6 },
    { stage: "FINISHING", daysBeforeExFactory: 2 },
    { stage: "INSPECTION", daysBeforeExFactory: 1 },
    { stage: "EX_FACTORY", daysBeforeExFactory: 0 },
  ],
  "Printed knit": [
    { stage: "CUTTING", daysBeforeExFactory: 24 },
    { stage: "PRINTING", daysBeforeExFactory: 14 },
    { stage: "STITCHING", daysBeforeExFactory: 6 },
    { stage: "FINISHING", daysBeforeExFactory: 2 },
    { stage: "INSPECTION", daysBeforeExFactory: 1 },
    { stage: "EX_FACTORY", daysBeforeExFactory: 0 },
  ],
} as const satisfies Record<string, readonly TemplateStep<SeedStage>[]>;

export const UNITS = [
  { name: "Unit 1", type: "OWN" },
  { name: "Unit 2", type: "OWN" },
  { name: "Unit 3", type: "OWN" },
  { name: "Printing partner", type: "SUBCONTRACT" },
  { name: "Washing partner", type: "SUBCONTRACT" },
] as const;

export type UnitName = (typeof UNITS)[number]["name"];

/** Fictional people. `.example` addresses can never reach a real inbox. */
export const MERCHANDISER = { name: "Priya", email: "priya@companya.example" };

export const SUPERVISORS: readonly { name: string; email: string; unit: UnitName }[] = [
  { name: "Murugan", email: "murugan@companya.example", unit: "Unit 1" },
  { name: "Selvi", email: "selvi@companya.example", unit: "Unit 2" },
  { name: "Kumar", email: "kumar@companya.example", unit: "Unit 3" },
  { name: "Lakshmi", email: "lakshmi@printpartner.example", unit: "Printing partner" },
];

export const BUYERS = [
  { name: "Company B", country: "UK" },
  { name: "Company C", country: "Germany" },
] as const;

export interface DayOutput {
  date: IsoDate;
  qty: number;
}

/** Splits a finished stage's total evenly over the working days ending on `lastDay`. */
function evenOutputs(total: number, lastDay: IsoDate, days: number): DayOutput[] {
  const dates: IsoDate[] = [];
  let date = lastDay;
  while (dates.length < days) {
    if (isWorkingDay(date, NO_HOLIDAYS)) dates.unshift(date);
    date = addDays(date, -1);
  }
  const perDay = Math.floor(total / days);
  return dates.map((day, index) => ({
    date: day,
    qty: index === days - 1 ? total - perDay * (days - 1) : perDay,
  }));
}

export interface SeedNote {
  date: IsoDate;
  stage: SeedStage;
  original: string;
  translated: string;
  category: SeedCategory;
  confidence: number;
}

export interface SeedOrder {
  poNumber: string;
  buyer: (typeof BUYERS)[number]["name"];
  style: string;
  colour: string;
  totalQty: number;
  exFactoryDate: IsoDate;
  template: keyof typeof TEMPLATES;
  unit: UnitName;
  /** Stages done somewhere other than the order's own unit. */
  stageUnits?: Partial<Record<SeedStage, UnitName>>;
  sizes: Record<string, number>;
  /** Stages with no entry have not started. */
  outputs: Partial<Record<SeedStage, DayOutput[]>>;
  notes: SeedNote[];
}

export const SAMPLE_ORDERS: readonly SeedOrder[] = [
  {
    poNumber: "B-PO-88213",
    buyer: "Company B",
    style: "Men's crew neck tee",
    colour: "Navy",
    totalQty: 12000,
    exFactoryDate: "2026-11-20",
    template: "Plain knit",
    unit: "Unit 1",
    sizes: { S: 2400, M: 4200, L: 3600, XL: 1800 },
    outputs: {
      CUTTING: evenOutputs(12000, "2026-10-31", 6),
      STITCHING: [
        ...evenOutputs(5000, "2026-11-03", 8),
        { date: "2026-11-04", qty: 620 },
        { date: "2026-11-05", qty: 580 },
        { date: "2026-11-06", qty: 600 },
      ],
    },
    notes: [
      {
        date: "2026-11-06",
        stage: "STITCHING",
        original: "நேற்று 2 மெஷின் பழுதானது",
        translated: "2 machines broke down yesterday",
        category: "MACHINE_BREAKDOWN",
        confidence: 0.94,
      },
    ],
  },
  {
    poNumber: "B-PO-88240",
    buyer: "Company B",
    style: "Men's polo",
    colour: "White",
    totalQty: 8000,
    exFactoryDate: "2026-11-12",
    template: "Plain knit",
    unit: "Unit 2",
    sizes: { S: 1600, M: 2800, L: 2400, XL: 1200 },
    outputs: {
      CUTTING: evenOutputs(8000, "2026-10-24", 5),
      STITCHING: evenOutputs(8000, "2026-11-05", 10),
      FINISHING: [
        ...evenOutputs(2800, "2026-11-03", 4),
        { date: "2026-11-04", qty: 820 },
        { date: "2026-11-05", qty: 780 },
        { date: "2026-11-06", qty: 800 },
      ],
    },
    notes: [
      {
        date: "2026-11-05",
        stage: "FINISHING",
        original: "பட்டன் வரவில்லை, நாளை வரலாம்",
        translated: "Buttons have not arrived, may come tomorrow",
        category: "TRIMS_SHORTAGE",
        confidence: 0.58,
      },
    ],
  },
  {
    poNumber: "C-PO-0488",
    buyer: "Company C",
    style: "Kids printed tee",
    colour: "Yellow",
    totalQty: 10000,
    exFactoryDate: "2026-11-28",
    template: "Printed knit",
    unit: "Unit 3",
    stageUnits: { PRINTING: "Printing partner" },
    sizes: { "2-3Y": 2000, "4-5Y": 3000, "6-7Y": 3000, "8-9Y": 2000 },
    outputs: {
      CUTTING: evenOutputs(10000, "2026-11-03", 5),
      PRINTING: [
        { date: "2026-11-04", qty: 1000 },
        { date: "2026-11-05", qty: 1050 },
        { date: "2026-11-06", qty: 1050 },
      ],
    },
    notes: [],
  },
];

/** The buyer link's lifetime in working days from the demo date. */
export const LINK_EXPIRY: IsoDate = addWorkingDays(DEMO_TODAY, 90, NO_HOLIDAYS);

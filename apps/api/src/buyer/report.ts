import ExcelJS from "exceljs";
import { addDays, type IsoDate } from "../risk/calendar.js";

/** The buyer-safe view of one order, as the buyer's page shows it, plus its date history. */
export interface ReportOrder {
  poNumber: string;
  style: string;
  colour: string;
  totalQty: number;
  exFactoryDate: IsoDate;
  progress: "SHIPPED" | "IN_PROGRESS" | "SLIGHT_DELAY" | "DELAYED";
  reason: string | null;
  milestones: { stage: string; plannedDate: IsoDate; completedOn: IsoDate | null; percentDone: number | null }[];
  dateHistory: { stage: string; from: string | null; to: string | null; reason: string; at: string }[];
}

export interface ReportInput {
  buyerName: string;
  today: IsoDate;
  orders: ReportOrder[];
}

const STAGE: Record<string, string> = {
  CUTTING: "Cutting",
  PRINTING: "Printing",
  WASHING: "Washing",
  STITCHING: "Stitching",
  FINISHING: "Finishing",
  INSPECTION: "Inspection",
  EX_FACTORY: "Ex-factory",
};

const PROGRESS: Record<ReportOrder["progress"], { label: string; fill: string; font: string }> = {
  IN_PROGRESS: { label: "In progress", fill: "FFE3E7E1", font: "FF47585C" },
  SLIGHT_DELAY: { label: "Slight delay", fill: "FFFDEFC8", font: "FF7A4F00" },
  DELAYED: { label: "Delayed", fill: "FFFBE6E2", font: "FFA61E1A" },
  SHIPPED: { label: "Shipped", fill: "FFDBF2E3", font: "FF12643C" },
};

const PEACOCK = "FF0A3A45";
const INK2 = "FF47585C";
const LINE = "FFD9DCD2";
const FONT = "Arial";
const DATE_FORMAT = "d mmm yyyy";

/** Calendar dates go into Excel as midnight UTC, so a date never shifts by the reader's time zone. */
const excelDate = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`);
const long = (iso: IsoDate) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(excelDate(iso));

/** Monday to Sunday around a date, the week the factory reports in. */
export function weekOf(today: IsoDate): { start: IsoDate; end: IsoDate } {
  const day = excelDate(today).getUTCDay();
  const start = addDays(today, -((day + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** The stage being worked now, and the one after it, by the milestones' order. */
function nowAndNext(order: ReportOrder) {
  const open = order.milestones.findIndex((m) => !m.completedOn);
  if (open === -1) return { now: null, next: null };
  return { now: order.milestones[open] ?? null, next: order.milestones[open + 1] ?? null };
}

/** The date a change was made, in India, where the factory makes it. */
const changedOn = (at: string): IsoDate => new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10);

function styleHeader(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PEACOCK } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function styleBody(row: ExcelJS.Row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: FONT, size: 10, ...(cell.font ?? {}) };
    cell.alignment = { vertical: "top", wrapText: true, ...(cell.alignment ?? {}) };
    cell.border = { bottom: { style: "thin", color: { argb: LINE } } };
  });
}

/** Two title lines above each sheet's table, so a printed or forwarded page says what it is. */
function titleRows(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number) {
  sheet.addRow([title]).font = { name: FONT, size: 15, bold: true, color: { argb: PEACOCK } };
  sheet.addRow([subtitle]).font = { name: FONT, size: 10, color: { argb: INK2 } };
  sheet.addRow([]);
  sheet.mergeCells(1, 1, 1, columns);
  sheet.mergeCells(2, 1, 2, columns);
}

/**
 * The weekly progress report a buyer receives, as an Excel workbook. It is built only from the
 * buyer-safe view of each order, so it can never show more than the buyer's link does: no
 * internal figures, notes, units or staff, and a delay only once a merchandiser has confirmed it.
 */
export async function buildWeeklyReport({ buyerName, today, orders }: ReportInput): Promise<Buffer> {
  const { start, end } = weekOf(today);
  const book = new ExcelJS.Workbook();
  book.creator = "Nool";
  book.created = excelDate(today);
  const subtitle = `Week of ${long(start)} to ${long(end)}. Figures as of ${long(today)}. Read-only, from the factory floor's daily reports.`;

  // --- Summary: one row per order, the same answers as the buyer's page.
  const summary = book.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
  summary.columns = [
    { key: "po", width: 15 },
    { key: "style", width: 26 },
    { key: "colour", width: 11 },
    { key: "qty", width: 10 },
    { key: "exFactory", width: 13 },
    { key: "status", width: 13 },
    { key: "reason", width: 20 },
    { key: "now", width: 13 },
    { key: "done", width: 10 },
    { key: "next", width: 13 },
    { key: "nextDate", width: 13 },
  ];
  titleRows(summary, `${buyerName}: weekly order progress`, subtitle, 11);
  styleHeader(summary.addRow(["PO", "Style", "Colour", "Pieces", "Ex-factory", "Status", "Reason", "Now", "Done", "Next", "Planned"]));
  for (const order of orders) {
    const { now, next } = nowAndNext(order);
    const row = summary.addRow({
      po: order.poNumber,
      style: order.style,
      colour: order.colour,
      qty: order.totalQty,
      exFactory: excelDate(order.exFactoryDate),
      status: PROGRESS[order.progress].label,
      reason: order.reason ?? "",
      now: now ? STAGE[now.stage] : "",
      done: now?.percentDone === null || now?.percentDone === undefined ? null : now.percentDone / 100,
      next: next ? STAGE[next.stage] : "",
      nextDate: next ? excelDate(next.plannedDate) : null,
    });
    styleBody(row);
    row.getCell("po").font = { name: FONT, size: 10, bold: true };
    row.getCell("qty").numFmt = "#,##0";
    row.getCell("exFactory").numFmt = DATE_FORMAT;
    row.getCell("nextDate").numFmt = DATE_FORMAT;
    row.getCell("done").numFmt = "0%";
    const status = PROGRESS[order.progress];
    row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: status.fill } };
    row.getCell("status").font = { name: FONT, size: 10, bold: true, color: { argb: status.font } };
  }
  if (orders.length === 0) summary.addRow(["No orders in production."]).font = { name: FONT, size: 10, italic: true };

  // --- Stages: every milestone of every order, for a buyer who tracks the plan in detail.
  const stages = book.addWorksheet("Stages", { views: [{ state: "frozen", ySplit: 4 }] });
  stages.columns = [
    { key: "po", width: 15 },
    { key: "stage", width: 14 },
    { key: "planned", width: 13 },
    { key: "done", width: 10 },
    { key: "finished", width: 13 },
    { key: "thisWeek", width: 18 },
  ];
  titleRows(stages, `${buyerName}: stage plan`, subtitle, 6);
  styleHeader(stages.addRow(["PO", "Stage", "Planned", "Done", "Finished on", "Due this week"]));
  for (const order of orders) {
    for (const milestone of order.milestones) {
      const dueThisWeek = !milestone.completedOn && milestone.plannedDate >= start && milestone.plannedDate <= end;
      const row = stages.addRow({
        po: order.poNumber,
        stage: STAGE[milestone.stage],
        planned: excelDate(milestone.plannedDate),
        done: milestone.percentDone === null ? null : milestone.percentDone / 100,
        finished: milestone.completedOn ? excelDate(milestone.completedOn) : null,
        thisWeek: dueThisWeek ? "Yes" : "",
      });
      styleBody(row);
      row.getCell("planned").numFmt = DATE_FORMAT;
      row.getCell("finished").numFmt = DATE_FORMAT;
      row.getCell("done").numFmt = "0%";
      if (dueThisWeek) row.getCell("thisWeek").font = { name: FONT, size: 10, bold: true, color: { argb: PEACOCK } };
    }
  }

  // --- Date changes made this week, with the reason given, as the buyer's page shows them.
  const changes = book.addWorksheet("Date changes", { views: [{ state: "frozen", ySplit: 4 }] });
  changes.columns = [
    { key: "po", width: 15 },
    { key: "stage", width: 14 },
    { key: "from", width: 13 },
    { key: "to", width: 13 },
    { key: "reason", width: 40 },
    { key: "on", width: 13 },
  ];
  titleRows(changes, `${buyerName}: date changes this week`, subtitle, 6);
  styleHeader(changes.addRow(["PO", "Stage", "From", "To", "Reason", "Changed on"]));
  let changed = 0;
  for (const order of orders) {
    for (const entry of order.dateHistory) {
      // Every change since the week began. No upper bound: a change cannot be made in the future,
      // and with the demo's pinned date a change made today is stamped later than "today".
      const on = changedOn(entry.at);
      if (on < start) continue;
      changed += 1;
      const row = changes.addRow({
        po: order.poNumber,
        stage: STAGE[entry.stage] ?? entry.stage,
        from: entry.from ? excelDate(entry.from.slice(0, 10)) : null,
        to: entry.to ? excelDate(entry.to.slice(0, 10)) : null,
        reason: entry.reason,
        on: excelDate(on),
      });
      styleBody(row);
      for (const key of ["from", "to", "on"]) row.getCell(key).numFmt = DATE_FORMAT;
    }
  }
  if (changed === 0) changes.addRow(["No dates changed this week."]).font = { name: FONT, size: 10, italic: true, color: { argb: INK2 } };

  for (const sheet of [summary, stages, changes]) {
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}

/** A file name a buyer can keep a run of, sorting by week. */
export const reportFileName = (buyerName: string, today: IsoDate) =>
  `Nool-${buyerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-week-${weekOf(today).start}.xlsx`;

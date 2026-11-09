import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MURUGAN, PRIYA, prisma, seed, signIn, testApp } from "./helpers.js";

let tokens: Record<string, string>;

beforeEach(async () => {
  tokens = await seed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Supertest buffers a binary body only when asked to. */
const asBuffer = (res: request.Response, callback: (error: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};

/** Every cell's text in every sheet, to check what the workbook could ever reveal. */
async function readWorkbook(file: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file as unknown as ArrayBuffer);
  const sheets: Record<string, string[][]> = {};
  book.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = row.values as unknown[];
      rows.push(values.slice(1).map((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? ""))));
    });
    sheets[sheet.name] = rows;
  });
  return sheets;
}

const download = (app: ReturnType<typeof testApp>["app"], token: string | undefined) => {
  const call = request(app).get("/api/buyer/report.xlsx").buffer(true).parse(asBuffer);
  return token ? call.set("x-buyer-token", token) : call;
};

describe("weekly buyer report", () => {
  it("gives a buyer an Excel file of their own orders and nothing else", async () => {
    const { app } = testApp();
    const res = await download(app, tokens["Company B"]);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(XLSX);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Nool-Company-B-week-2026-11-02.xlsx"');

    const sheets = await readWorkbook(res.body as Buffer);
    expect(Object.keys(sheets)).toEqual(["Summary", "Stages", "Date changes"]);
    const pos = sheets.Summary!.slice(3).map((row) => row[0]);
    expect(pos.sort()).toEqual(["B-PO-88213", "B-PO-88240"]);

    // Nothing the buyer's page keeps back: other buyers, units, people or the notes' words.
    const everything = JSON.stringify(sheets);
    for (const hidden of ["C-PO-0488", "Kids printed", "Unit 1", "Unit 2", "Murugan", "Selvi", "மெஷின்", "பட்டன்"]) {
      expect(everything).not.toContain(hidden);
    }
  });

  it("states the week it covers and every stage's plan", async () => {
    const { app } = testApp();
    const sheets = await readWorkbook((await download(app, tokens["Company B"])).body as Buffer);

    expect(sheets.Summary![0]![0]).toBe("Company B: weekly order progress");
    expect(sheets.Summary![1]![0]).toContain("Week of 2 Nov 2026 to 8 Nov 2026");
    const polo = sheets.Summary!.find((row) => row[0] === "B-PO-88240")!;
    expect(polo.slice(1, 5)).toEqual(["Men's polo", "White", "8000", "2026-11-12"]);
    expect(sheets.Stages!.filter((row) => row[0] === "B-PO-88240").map((row) => row[1])).toEqual([
      "Cutting",
      "Stitching",
      "Finishing",
      "Inspection",
      "Ex-factory",
    ]);
  });

  it("lists this week's date changes with their reasons", async () => {
    const { app } = testApp();
    const merchandiser = await signIn(app, PRIYA);
    const order = await prisma.order.findFirstOrThrow({ where: { poNumber: "B-PO-88213" } });
    await merchandiser.patch(`/api/orders/${order.id}/ex-factory`).send({ date: "2026-11-24", reason: "Buyer agreed to a later ship date" });

    const sheets = await readWorkbook((await download(app, tokens["Company B"])).body as Buffer);
    const change = sheets["Date changes"]!.find((row) => row[0] === "B-PO-88213")!;
    expect(change.slice(1, 5)).toEqual(["Ex-factory", "2026-11-20", "2026-11-24", "Buyer agreed to a later ship date"]);
  });

  it("refuses a missing or made-up link", async () => {
    const { app } = testApp();
    expect((await download(app, undefined)).status).toBe(401);
    expect((await download(app, "made-up-token")).status).toBe(401);
  });

  it("lets a merchandiser download any buyer's report, and not a supervisor", async () => {
    const { app } = testApp();
    const buyer = await prisma.buyer.findFirstOrThrow({ where: { name: "Company C" } });
    const merchandiser = await signIn(app, PRIYA);
    const res = await merchandiser.get(`/api/buyers/${buyer.id}/report.xlsx`).buffer(true).parse(asBuffer);
    expect(res.status).toBe(200);
    const sheets = await readWorkbook(res.body as Buffer);
    expect(sheets.Summary!.slice(3).map((row) => row[0])).toEqual(["C-PO-0488"]);

    const supervisor = await signIn(app, MURUGAN);
    expect((await supervisor.get(`/api/buyers/${buyer.id}/report.xlsx`)).status).toBe(403);
  });
});

import { describe, expect, it } from "vitest";
import { missedCountMessage, orderRedMessage } from "./messages.js";
import { minutesInIndia, missedStages, parseTime, type StageRow } from "./rules.js";

const stage = (overrides: Partial<StageRow> & Pick<StageRow, "id" | "sequence">): StageRow => ({
  orderId: "order",
  completed: false,
  doneQty: 0,
  reported: false,
  ...overrides,
});

describe("missedStages", () => {
  it("flags a stage under way with no count for the day", () => {
    const rows = [
      stage({ id: "cutting", sequence: 1, completed: true, doneQty: 100 }),
      stage({ id: "stitching", sequence: 2, doneQty: 40 }),
      stage({ id: "finishing", sequence: 3 }),
    ];
    expect(missedStages(rows).map((row) => row.id)).toEqual(["stitching"]);
  });

  it("does not flag a stage that has not started", () => {
    const rows = [stage({ id: "cutting", sequence: 1, doneQty: 50 }), stage({ id: "stitching", sequence: 2 })];
    expect(missedStages(rows).map((row) => row.id)).toEqual(["cutting"]);
  });

  it("treats a stage after a finished one as started, even with nothing done yet", () => {
    const rows = [stage({ id: "cutting", sequence: 1, completed: true }), stage({ id: "printing", sequence: 2 })];
    expect(missedStages(rows).map((row) => row.id)).toEqual(["printing"]);
  });

  it("does not flag a stage someone reported, or a finished one", () => {
    const rows = [
      stage({ id: "cutting", sequence: 1, completed: true, doneQty: 100 }),
      stage({ id: "stitching", sequence: 2, doneQty: 40, reported: true }),
    ];
    expect(missedStages(rows)).toEqual([]);
  });

  it("looks at each order on its own", () => {
    const rows = [
      stage({ id: "a-cutting", orderId: "a", sequence: 1, doneQty: 10 }),
      stage({ id: "b-cutting", orderId: "b", sequence: 1, completed: true }),
      stage({ id: "b-stitching", orderId: "b", sequence: 2, reported: true }),
    ];
    expect(missedStages(rows).map((row) => row.id)).toEqual(["a-cutting"]);
  });
});

describe("time of day in India", () => {
  it("adds five and a half hours to UTC", () => {
    expect(minutesInIndia(new Date("2026-11-06T12:00:00Z"))).toBe(17 * 60 + 30);
  });

  it("wraps past midnight", () => {
    expect(minutesInIndia(new Date("2026-11-06T20:00:00Z"))).toBe(1 * 60 + 30);
  });

  it("reads times written as HH:MM, and refuses anything else", () => {
    expect(parseTime("17:30")).toBe(1050);
    expect(parseTime("9:05")).toBe(545);
    expect(() => parseTime("25:00")).toThrow();
    expect(() => parseTime("half past five")).toThrow();
  });
});

describe("messages", () => {
  it("writes a supervisor's reminder in Tamil when that is their language", () => {
    const message = missedCountMessage("ta", "2026-11-06", [{ stage: "STITCHING", poNumber: "B-PO-88213" }]);
    expect(message.body).toContain("தையல் (B-PO-88213)");
    expect(message.body).toContain("6 Nov");
  });

  it("says plainly when the ex-factory date has passed", () => {
    expect(orderRedMessage("B-PO-1", "2026-11-05", "2026-11-10", 5, true).body).toBe(
      "Its ex-factory date of 5 Nov has passed and it has not shipped.",
    );
  });

  it("says by how much an order will miss its date", () => {
    expect(orderRedMessage("B-PO-88213", "2026-11-20", "2026-11-23", 3).body).toBe(
      "At the current pace it reaches ex-factory on 23 Nov, 3 days after 20 Nov.",
    );
  });
});

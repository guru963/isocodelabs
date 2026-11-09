import { describe, expect, it } from "vitest";
import { runScenarios } from "./scenarios.js";

describe("scenario lab", () => {
  it("passes every scenario that needs no database", async () => {
    const results = await runScenarios(null, () => "2026-11-06", null);
    const failed = results.filter((r) => !r.pass).map((r) => `${r.title}: ${r.actual}`);
    expect(failed).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(20);
  });

  it("covers each group with plain-language setup and expectation", async () => {
    const results = await runScenarios(null, () => "2026-11-06", null);
    expect(new Set(results.map((r) => r.group))).toEqual(new Set(["Delay projection", "Catch-up planner", "Order setup", "AI on notes"]));
    for (const r of results) {
      expect(r.setup.length).toBeGreaterThan(10);
      expect(r.expected.length).toBeGreaterThan(3);
    }
  });
});

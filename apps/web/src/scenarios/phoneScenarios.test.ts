import { describe, expect, it } from "vitest";
import { runPhoneScenarios } from "./phoneScenarios";

describe("phone queue scenarios", () => {
  it("all pass against the real queue code", async () => {
    const results = await runPhoneScenarios();
    expect(results.filter((r) => !r.pass).map((r) => `${r.title}: ${r.actual}`)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(10);
  });
});

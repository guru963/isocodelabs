import { describe, expect, it } from "vitest";
import { ClassificationError, needsReview, parseClassification } from "./classification.js";

const reply = (fields: object) => JSON.stringify(fields);

describe("parseClassification", () => {
  it("accepts a valid reply", () => {
    const text = reply({ translation: "2 machines broke", category: "MACHINE_BREAKDOWN", confidence: 0.9 });
    expect(parseClassification(text)).toEqual({
      translation: "2 machines broke",
      category: "MACHINE_BREAKDOWN",
      confidence: 0.9,
    });
  });

  it("turns an unknown category into OTHER at zero confidence, keeping the translation", () => {
    const text = reply({ translation: "Lunch was late", category: "CANTEEN", confidence: 0.99 });
    expect(parseClassification(text)).toEqual({ translation: "Lunch was late", category: "OTHER", confidence: 0 });
  });

  it.each([
    ["text that is not JSON", "Sorry, I cannot help"],
    ["cut-off JSON", '{"translation": "2 mach'],
    ["a missing field", reply({ translation: "x", category: "OTHER" })],
    ["an empty translation", reply({ translation: " ", category: "OTHER", confidence: 0.5 })],
    ["confidence out of range", reply({ translation: "x", category: "OTHER", confidence: 7 })],
  ])("rejects %s", (_, text) => {
    expect(() => parseClassification(text)).toThrow(ClassificationError);
  });
});

describe("needsReview", () => {
  it("flags low confidence, missing confidence and failed runs", () => {
    expect(needsReview({ aiStatus: "COMPLETED", aiConfidence: 0.69 })).toBe(true);
    expect(needsReview({ aiStatus: "COMPLETED", aiConfidence: null })).toBe(true);
    expect(needsReview({ aiStatus: "FAILED", aiConfidence: 0.95 })).toBe(true);
    expect(needsReview({ aiStatus: "PENDING", aiConfidence: null })).toBe(true);
  });

  it("does not flag a confident result", () => {
    expect(needsReview({ aiStatus: "COMPLETED", aiConfidence: 0.7 })).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { checkDraft, draftBuyerMessage, templateMessage, type BuyerMessageFacts } from "./buyerMessage.js";

const facts: BuyerMessageFacts = {
  buyerName: "Company B",
  poNumber: "B-PO-88213",
  style: "Men's crew neck tee",
  colour: "Navy",
  stage: "Finishing",
  agreedExFactory: "20 November 2026",
  newExFactory: "2 February 2027",
  reason: "Machine breakdown",
  actions: ["running finishing at 250 pieces a day, 25% above its current pace", "working Sunday 8 November and Sunday 15 November"],
  merchandiserName: "Priya",
};

describe("buyer message", () => {
  it("writes a template from the facts alone", () => {
    const message = templateMessage(facts);
    expect(message.subject).toBe("B-PO-88213: new ex-factory date 2 February 2027");
    expect(message.body).toContain("because of machine breakdown");
    expect(message.body).toContain("move it to 2 February 2027");
    expect(checkDraft(message, facts)).toBe(true);
  });

  it("refuses a draft that states a date or quantity it was not given", () => {
    const base = templateMessage(facts);
    expect(checkDraft({ ...base, body: `${base.body}\nWe could also ship 6,000 pieces early.` }, facts)).toBe(false);
    expect(checkDraft({ ...base, body: base.body.replace("2 February 2027", "28 January 2027") }, facts)).toBe(false);
  });

  it("accepts a quantity written with or without a thousands separator", () => {
    const withQty = { ...facts, actions: ["running finishing at 1,250 pieces a day"] };
    expect(checkDraft({ subject: "B-PO-88213", body: "1250 a day, new date 2 February 2027." }, withQty)).toBe(true);
  });

  it("uses the AI's draft when it passes the check", async () => {
    const ai = templateMessage(facts);
    const writer = { write: vi.fn().mockResolvedValue({ ...ai, body: ai.body.replace("Dear", "Hello") }) };
    const draft = await draftBuyerMessage(writer, facts);
    expect(draft.source).toBe("ai");
    expect(draft.body.startsWith("Hello")).toBe(true);
  });

  it("falls back to the template when the AI invents a figure, fails, or is not set up", async () => {
    const invented = { write: vi.fn().mockResolvedValue({ subject: "B-PO-88213", body: "New date 2 February 2027, or 30 January." }) };
    expect((await draftBuyerMessage(invented, facts)).source).toBe("template");
    const failing = { write: vi.fn().mockRejectedValue(new Error("timeout")) };
    expect((await draftBuyerMessage(failing, facts)).source).toBe("template");
    expect((await draftBuyerMessage(null, facts)).source).toBe("template");
  });
});

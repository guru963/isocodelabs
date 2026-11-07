import { describe, expect, it, vi } from "vitest";
import { ClassificationError } from "./classification.js";
import { createGroqClassifier } from "./groqClassifier.js";

const reply = (content: string | null, finishReason = "stop") =>
  new Response(
    JSON.stringify({
      id: "test",
      object: "chat.completion",
      created: 0,
      model: "groq-test",
      choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const valid = JSON.stringify({ translation: "2 machines broke", category: "MACHINE_BREAKDOWN", confidence: 0.9 });

const classifierReturning = (response: () => Response) => {
  const fetchFake = vi.fn(async (_url: unknown, _init?: RequestInit) => response());
  return { fetchFake, classifier: createGroqClassifier("test-key", "groq-test", fetchFake as typeof fetch) };
};

describe("Groq classifier", () => {
  it("sends the note to Groq with the key, the model and a strict schema", async () => {
    const { classifier, fetchFake } = classifierReturning(() => reply(valid));

    await classifier.classify("மெஷின் பழுது");

    const [url, init] = fetchFake.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(String(url)).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    expect(body.model).toBe("groq-test");
    expect(body.messages[1].content).toBe("<note>மெஷின் பழுது</note>");
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["translation", "category", "confidence"]);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it("returns the validated result", async () => {
    const { classifier } = classifierReturning(() => reply(valid));
    await expect(classifier.classify("note")).resolves.toEqual({
      translation: "2 machines broke",
      category: "MACHINE_BREAKDOWN",
      confidence: 0.9,
    });
  });

  it.each([
    ["a reply cut off at the length limit", () => reply(valid, "length")],
    ["an empty reply", () => reply(null)],
    ["text that is not JSON", () => reply("I cannot help with that")],
    ["confidence outside 0 to 1", () => reply(JSON.stringify({ translation: "x", category: "OTHER", confidence: 7 }))],
  ])("fails safely on %s", async (_, response) => {
    const { classifier } = classifierReturning(response);
    await expect(classifier.classify("note")).rejects.toBeInstanceOf(ClassificationError);
  });

  it("surfaces a rejected API key as an error, which the queue then handles", async () => {
    const { classifier } = classifierReturning(
      () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
    );
    await expect(classifier.classify("note")).rejects.toThrow();
  });
});

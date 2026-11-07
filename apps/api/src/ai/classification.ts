import type { IssueCategory } from "@prisma/client";
import { z } from "zod";

export const CATEGORIES = [
  "POWER_CUT",
  "MACHINE_BREAKDOWN",
  "WORKER_ABSENCE",
  "FABRIC_DELAY",
  "SUBCONTRACTOR_DELAY",
  "QUALITY_REWORK",
  "TRIMS_SHORTAGE",
  "OTHER",
] as const satisfies readonly IssueCategory[];

/** Below this, the review screen marks the result as needing a closer look. Assumption. */
export const REVIEW_CONFIDENCE = 0.7;

export interface Classification {
  translation: string;
  category: IssueCategory;
  confidence: number;
}

export interface NoteClassifier {
  classify(note: string): Promise<Classification>;
}

export class ClassificationError extends Error {}

const responseSchema = z.object({
  translation: z.string().trim().min(1),
  category: z.string(),
  confidence: z.number().min(0).max(1),
});

/**
 * Trusts nothing from the model. A reply that is not valid fails and is retried. An unknown
 * category keeps the translation but becomes OTHER at zero confidence, so a person checks it.
 */
export function parseClassification(text: string): Classification {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ClassificationError("The model did not return valid JSON");
  }
  const result = responseSchema.safeParse(json);
  if (!result.success) throw new ClassificationError("The model's reply did not match the schema");

  const { translation, category, confidence } = result.data;
  const known = CATEGORIES.find((candidate) => candidate === category);
  return known
    ? { translation, category: known, confidence }
    : { translation, category: "OTHER", confidence: 0 };
}

export const needsReview = (issue: {
  aiStatus: string;
  aiConfidence: number | null;
}): boolean =>
  issue.aiStatus !== "COMPLETED" || issue.aiConfidence === null || issue.aiConfidence < REVIEW_CONFIDENCE;

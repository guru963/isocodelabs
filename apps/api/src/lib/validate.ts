import { z } from "zod";
import { AppError } from "./errors.js";

export function parse<Schema extends z.ZodType>(schema: Schema, data: unknown): z.output<Schema> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, "VALIDATION", "Some fields are invalid", z.flattenError(result.error));
  }
  return result.data;
}

export const idParam = z.object({ id: z.uuid() });
export const isoDate = z.iso.date();

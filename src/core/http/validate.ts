import type { z } from "zod";
import { AppError } from "../errors.js";

/** Parse untrusted input with a zod schema, or throw a 400 with field-level details. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw AppError.badRequest("VALIDATION_FAILED", "Some fields are missing or wrong", details);
  }
  return result.data;
}

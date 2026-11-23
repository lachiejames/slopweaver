/**
 * The text schemas every pull-request form module shares: a leaf, so `./schema.ts` and the section schemas beside
 * it (`./reviewersSchema.ts`) import one spelling of "one non-blank line" without importing each other.
 */
import { z } from "zod";

/**
 * Non-blank text. `min(1)` is not enough: a cell whose only content is `" "` renders to nothing once trimmed.
 *
 * @returns the string schema
 */
export const nonBlank = (): z.ZodType<string> =>
  z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, "must not be blank — it renders to nothing and the PR gate trims it away");

/**
 * Every character that ends a line. `\p{Zl}` and `\p{Zp}` are exactly U+2028 and U+2029, in it because a JavaScript `.` does not match them,
 * so a parser regex reading a rendered line back stops at one exactly as it would at a newline.
 */
export const LINE_BREAK = /[\n\r\p{Zl}\p{Zp}]/u;

/**
 * Non-blank, single-line text.
 *
 * @param what the thing the text is, named in the refusal
 * @returns the string schema
 */
export function lineText({ what }: { what: string }): z.ZodType<string> {
  return nonBlank().refine(
    (value) => !LINE_BREAK.test(value),
    `${what} renders as ONE line, so a newline would break it. Remove it.`,
  );
}

/**
 * The one-line text check every incident form field shares — `./form.ts`'s and `./findingFields.ts`'s alike, so a
 * cap is refused in the same words wherever the field lives. Pure.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type IncidentFormInvalidError, IncidentNoteErrors } from "./errors.js";

/** The longest root-cause or impact line — a sentence or two, behind the disclosure row. */
export const FINDING_LINE_CAP = 300;

/**
 * A one-line text field, trimmed, or the refusal.
 *
 * @param value whatever the form carried
 * @param field the field's name in the form
 * @param cap the longest it may be
 * @returns the trimmed line, or why not
 */
export function line({
  value,
  field,
  cap,
}: {
  value: unknown;
  field: string;
  cap: number;
}): Result<string, IncidentFormInvalidError> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(IncidentNoteErrors.formInvalid({ field, why: "is required as text" }));
  }
  const text = value.trim();
  if (text.includes("\n")) {
    return err(IncidentNoteErrors.formInvalid({ field, why: "is one line" }));
  }
  if (text.length > cap) {
    return err(
      IncidentNoteErrors.formInvalid({
        field,
        why: `is ${String(text.length)} characters and the cap is ${String(cap)}: "${text.slice(0, 40)}…"`,
      }),
    );
  }
  return ok(text);
}

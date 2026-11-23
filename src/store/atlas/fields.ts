/**
 * Reading one field off a parsed atlas record, the four ways both halves of the projection need.
 *
 * Shared by `./project.ts` (an entity line) and `./envelope.ts` (line 1) rather than duplicated, because
 * the rules they encode are decisions and not conveniences: a blank string is absent, an absent LIST is an
 * empty one, and an instant that is present and unreadable is REFUSED rather than defaulted. A second copy
 * of any of those is a second place they can diverge.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type AtlasImportError, AtlasImportErrors } from "./errors.js";

/**
 * Read a field that must be a non-empty string.
 *
 * @param from the record to read
 * @param key the field name
 * @returns the string, or `null` when it is absent, not a string, or blank
 */
export function stringField({ from, key }: { from: Record<string, unknown>; key: string }): string | null {
  const value = from[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Read a field that must be a finite number.
 *
 * @param from the record to read
 * @param key the field name
 * @returns the number, or `null` when it is absent or not finite
 */
export function numberField({ from, key }: { from: Record<string, unknown>; key: string }): number | null {
  const value = from[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Read a field that must be an array of strings, treating an absent one as empty.
 *
 * Absent is empty rather than null because `fields` and `surfaces` are missing from 497 of the estate's gap
 * records and a missing list says the same thing about a gap as an empty one.
 *
 * @param from the record to read
 * @param key the field name
 * @returns every string member, in order
 */
export function stringArrayField({ from, key }: { from: Record<string, unknown>; key: string }): string[] {
  const value = from[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Turn an ISO string into an instant, refusing rather than defaulting.
 *
 * @param value what the document carried
 * @param field which field it was, for the refusal
 * @param path the file, for the refusal
 * @param lineNumber the line, for the refusal
 * @returns the instant, or why it could not be read
 */
export function instant({
  value,
  field,
  path,
  lineNumber,
}: {
  value: unknown;
  field: string;
  path: string;
  lineNumber: number;
}): Result<Date, AtlasImportError> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(AtlasImportErrors.missingField({ field, lineNumber, path }));
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return err(AtlasImportErrors.unreadableInstant({ field, lineNumber, path, value }));
  }
  return ok(parsed);
}

/**
 * An optional instant: absent stays absent, present-and-unreadable still refuses.
 *
 * @param value what the document carried
 * @param field which field it was, for the refusal
 * @param path the file, for the refusal
 * @param lineNumber the line, for the refusal
 * @returns the instant, `null` when the field was absent or null, or why it could not be read
 */
export function optionalInstant({
  value,
  field,
  path,
  lineNumber,
}: {
  value: unknown;
  field: string;
  path: string;
  lineNumber: number;
}): Result<Date | null, AtlasImportError> {
  if (value == null) {
    return ok(null);
  }
  return instant({ field, lineNumber, path, value });
}

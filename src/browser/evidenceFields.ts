/**
 * One field of the evidence-capture snippet's result, validated — a number, a rectangle, a visibility word, a
 * context control, a pair. Each is a refusal naming where it sat rather than a guess, so the result parser in
 * `evidenceParse.ts` can report every field it could not trust at once.
 */

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CssRect, RegionVisibility } from "../visualEvidence/observation.js";

import { type BrowserError, BrowserErrors, browserErrorLines } from "./browserErrors.js";

/**
 * Every problem the failed fields report, one line each, in field order.
 *
 * @returns one line per problem, empty when every field parsed
 */
export function problemsOf({ fields }: { fields: readonly Result<unknown, BrowserError>[] }): string[] {
  return fields.flatMap((field) => (field.isErr() ? [...browserErrorLines({ error: field.error })] : []));
}

/**
 * A finite number, or a named refusal.
 *
 * @returns the number, or the refusal naming where it should have been
 */
export function numberAt({
  record,
  key,
  at,
}: {
  record: Record<string, unknown>;
  key: string;
  at: string;
}): Result<number, BrowserError> {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err(BrowserErrors.evidenceNotANumber({ at, key }));
  }
  return ok(value);
}

/**
 * A rectangle with positive area, `null` when the field is `null`, or a named refusal.
 *
 * @returns the rectangle, `null`, or every coordinate that could not be trusted
 */
export function rectAt({
  record,
  key,
  at,
}: {
  record: Record<string, unknown>;
  key: string;
  at: string;
}): Result<CssRect | null, BrowserError> {
  const value = record[key];
  if (value === null) {
    return ok(null);
  }
  if (!isRecord(value)) {
    return err(BrowserErrors.evidenceRectInvalid({ at, key }));
  }
  const x = numberAt({ at: `${at}.${key}`, key: "x", record: value });
  const y = numberAt({ at: `${at}.${key}`, key: "y", record: value });
  const width = numberAt({ at: `${at}.${key}`, key: "width", record: value });
  const height = numberAt({ at: `${at}.${key}`, key: "height", record: value });
  const problems = problemsOf({ fields: [x, y, width, height] });
  if (problems.length > 0 || x.isErr() || y.isErr() || width.isErr() || height.isErr()) {
    return err(BrowserErrors.evidenceRefused({ reasons: problems }));
  }
  if (width.value <= 0 || height.value <= 0) {
    return err(BrowserErrors.evidenceRectEmpty({ at, height: height.value, key, width: width.value }));
  }
  return ok({ height: height.value, width: width.value, x: x.value, y: y.value });
}

/**
 * One of the three visibility words, or a named refusal.
 *
 * @returns the visibility word, or the refusal naming the word that was there
 */
export function visibilityAt({
  record,
  key,
  at,
}: {
  record: Record<string, unknown>;
  key: string;
  at: string;
}): Result<RegionVisibility, BrowserError> {
  const value = record[key];
  if (value === "visible" || value === "clipped" || value === "occluded") {
    return ok(value);
  }
  return err(BrowserErrors.evidenceVisibilityInvalid({ at, key, value }));
}

/**
 * A `{ rect, text, visibility }` context control, `null`, or a named refusal.
 *
 * @returns the control, `null`, or every part of it that could not be trusted
 */
export function contextAt({
  record,
  key,
  at,
}: {
  record: Record<string, unknown>;
  key: string;
  at: string;
}): Result<{ rect: CssRect; text: string; visibility: RegionVisibility } | null, BrowserError> {
  const value = record[key];
  if (value === null) {
    return ok(null);
  }
  if (!isRecord(value) || typeof value["text"] !== "string") {
    return err(BrowserErrors.evidenceContextInvalid({ at, key }));
  }
  const rect = rectAt({ at: `${at}.${key}`, key: "rect", record: value });
  const visibility = visibilityAt({ at: `${at}.${key}`, key: "visibility", record: value });
  if (rect.isErr() || visibility.isErr()) {
    return err(BrowserErrors.evidenceRefused({ reasons: problemsOf({ fields: [rect, visibility] }) }));
  }
  if (rect.value === null) {
    return err(BrowserErrors.evidenceContextRectMissing({ at, key }));
  }
  return ok({ rect: rect.value, text: value["text"], visibility: visibility.value });
}

/**
 * A `{ width, height }` or `{ x, y }` pair of finite numbers, or a named refusal.
 *
 * @returns the pair in `fields` order, or every half that could not be trusted
 */
export function pairAt({
  record,
  key,
  fields,
  at,
}: {
  record: Record<string, unknown>;
  key: string;
  fields: readonly [string, string];
  at: string;
}): Result<readonly [number, number], BrowserError> {
  const value = record[key];
  if (!isRecord(value)) {
    return err(BrowserErrors.evidenceNotAnObject({ at: `${at}.${key}` }));
  }
  const first = numberAt({ at: `${at}.${key}`, key: fields[0], record: value });
  const second = numberAt({ at: `${at}.${key}`, key: fields[1], record: value });
  if (first.isErr() || second.isErr()) {
    return err(BrowserErrors.evidenceRefused({ reasons: problemsOf({ fields: [first, second] }) }));
  }
  return ok([first.value, second.value]);
}

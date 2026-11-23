/**
 * The pure probes the Vendors tag's schema tests share: what a refusal looked like, which path each missing field
 * refuses at, and the rows that null one field at a time. In-memory Zod parsing only, no I/O.
 */
import type { z } from "zod";

/**
 * What a refusal looked like: the verdict and each issue with its message and regex pattern left out.
 *
 * @returns the parse verdict and every issue minus its message and pattern
 */
export function rejection({ input, schema }: { input: unknown; schema: z.ZodType }): {
  issues: Record<string, unknown>[];
  success: boolean;
} {
  const result = schema.safeParse(input);
  const issues = result.success ? [] : result.error.issues;
  return {
    issues: issues.map((issue) =>
      Object.fromEntries(Object.entries(issue).filter(([key]) => key !== "message" && key !== "pattern")),
    ),
    success: result.success,
  };
}

/**
 * The paths each refusal names when `row` loses one field at a time, one entry per field in field order.
 *
 * @returns one list of refusal paths per dropped field
 */
export function pathsWhenFieldMissing({
  row,
  schema,
}: {
  row: Record<string, unknown>;
  schema: z.ZodType;
}): unknown[][] {
  return Object.keys(row).map((missing) =>
    rejection({ input: { ...row, [missing]: undefined }, schema }).issues.map((issue) => issue["path"]),
  );
}

/**
 * As `pathsWhenFieldMissing`, for the object under `row[key]`: one entry per nested field in field order.
 *
 * @returns one list of refusal paths per dropped nested field
 */
export function pathsWhenNestedFieldMissing({
  key,
  nested,
  row,
  schema,
}: {
  key: string;
  nested: Record<string, unknown>;
  row: Record<string, unknown>;
  schema: z.ZodType;
}): unknown[][] {
  return Object.keys(nested).map((missing) =>
    rejection({ input: { ...row, [key]: { ...nested, [missing]: undefined } }, schema }).issues.map(
      (issue) => issue["path"],
    ),
  );
}

/**
 * One copy of `row` for each key in `keys`, each copy with exactly that key null and every other field as it was.
 *
 * @returns one copy of the row per named key, that key nulled
 */
export function rowsWithOneNull({ keys, row }: { keys: readonly string[]; row: Record<string, unknown> }): unknown[] {
  return keys.map((key) => ({ ...row, [key]: null }));
}

/**
 * As `rowsWithOneNull`, for the fields of the object under `row[key]`: each copy nulls one nested field only.
 *
 * @returns one copy of the row per named nested key, that nested key nulled
 */
export function rowsWithOneNestedNull({
  key,
  keys,
  nested,
  row,
}: {
  key: string;
  keys: readonly string[];
  nested: Record<string, unknown>;
  row: Record<string, unknown>;
}): unknown[] {
  return keys.map((inner) => ({ ...row, [key]: { ...nested, [inner]: null } }));
}

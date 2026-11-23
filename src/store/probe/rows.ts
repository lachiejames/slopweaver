/**
 * Reading a driver row without lying about what came back.
 *
 * A `postgres.js` row arrives as `Record<string, unknown>`, so every column read is a narrowing decision.
 * Making it here, once, rather than at each of the twenty-odd call sites is what stops two of them
 * disagreeing — and the house rule this module exists to satisfy is the reason it FAILS rather than
 * substitutes: `String(row["x"] ?? "")` turns an absent column into an empty string, so a renamed column
 * renders as a blank field in a detective's report and nothing anywhere says the query was wrong.
 *
 * Pure: no I/O, no clock.
 */

/**
 * Read a column the schema declares `NOT NULL`, and throw when it is missing or not a string.
 *
 * Throwing is correct here and is not defensive ceremony: every caller selects its own columns by name in
 * the same module, so a miss is a fault in the statement beside it rather than anything a caller supplied,
 * and it is exactly the class that renders as a silently blank field if it is coalesced away instead.
 *
 * @param row one row as the driver returned it
 * @param key which column
 * @returns the column's value
 */
export function requireText({ row, key }: { row: Record<string, unknown>; key: string }): string {
  const value = row[key];
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`store row has no string "${key}" — the statement and the reader disagree`);
}

/**
 * Read a column that is legitimately nullable.
 *
 * @param row one row as the driver returned it
 * @param key which column
 * @returns the value, or nothing when the column is null
 */
export function optionalText({ row, key }: { row: Record<string, unknown>; key: string }): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/**
 * Read a counted or measured column, whatever width the driver handed it back as.
 *
 * `count(*)::bigint` arrives as a STRING, because a 64-bit integer does not fit a JS number safely and the
 * driver refuses to lose the difference silently. Every count in this store is far below that ceiling, so
 * parsing here is correct — reading it as a number without the cast produced `NaN` on every cell, which is
 * the failure this function exists to make impossible.
 *
 * @param row one row as the driver returned it
 * @param key which column
 * @returns the number, or zero when the column is absent or unparseable
 */
export function numberOf({ row, key }: { row: Record<string, unknown>; key: string }): number {
  const raw = row[key];
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof raw !== "string") {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

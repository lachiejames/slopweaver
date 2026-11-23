/**
 * What PostgreSQL cannot hold as written, judged before a write so it is a typed refusal rather than a store error.
 *
 * A position past the `integer` column's range would pass validation and then fail the insert, which the port can
 * only report as `WORKSTREAM_STORE_UNAVAILABLE`; so would a write at the largest revision, whose bump overflows the
 * same column. The same is true of a string: `text` and `jsonb`
 * refuse U+0000 outright, and a lone UTF-16 surrogate is replaced when the driver encodes it as UTF-8, so the value
 * read back differs from the one written.
 *
 * Pure.
 */

/** The largest value a PostgreSQL `integer` column holds: every position, and every revision. */
export const STORE_INTEGER_MAX = 2_147_483_647;

/**
 * The longest text an index carries: a workstream id, a milestone id, an `after` id, a link target. Every one is
 * ASCII by its grammar, so characters are bytes, and the widest key (`workstream_id, kind, target`) stays far under a
 * B-tree row's 2704-byte ceiling, which an incompressible 6400-character id breaks on insert.
 * Repro: the integration case "refuses an indexed text past the store's longest".
 */
export const STORE_KEY_MAX_CHARACTERS = 256;

/**
 * How many rows, or `in (…)` values, one statement carries. PostgreSQL's wire protocol numbers a statement's bind
 * parameters in 16 bits, 65535 at most, and the widest row the store inserts (an entry) binds nine — so 10000 entries
 * in one insert fails where the in-memory store keeps them. The store writes in runs of this
 * size instead of bounding the count. Repro: the integration case "writes an aggregate past one statement's bind
 * parameters".
 */
const STORE_ROWS_PER_STATEMENT = 1000;

/**
 * Split a list into runs one statement can carry, in order.
 *
 * @returns the runs, each at most {@link STORE_ROWS_PER_STATEMENT} long; none for an empty list
 */
export function statementRuns<Item>({ items }: { items: readonly Item[] }): readonly (readonly Item[])[] {
  const runs: (readonly Item[])[] = [];
  for (let start = 0; start < items.length; start += STORE_ROWS_PER_STATEMENT) {
    runs.push(items.slice(start, start + STORE_ROWS_PER_STATEMENT));
  }
  return runs;
}

/** A surrogate half with no partner — under the `u` flag a paired surrogate is one code point, outside this range. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/**
 * Whether PostgreSQL would refuse or alter one string.
 *
 * @returns true when it carries U+0000 or a lone surrogate
 */
function unstorable({ text }: { text: string }): boolean {
  return text.includes("\u0000") || LONE_SURROGATE.test(text);
}

/**
 * Whether a position is a whole number a PostgreSQL `integer` column holds, from zero.
 *
 * @returns true when it is storable
 */
export function isStorablePosition({ position }: { position: number }): boolean {
  return Number.isInteger(position) && position >= 0 && position <= STORE_INTEGER_MAX;
}

/**
 * Why a write at this expected revision cannot land: no stored row carries it — a real revision is a whole number
 * from 1 — or the write would bump it past the column at its largest. Judged before the store is asked, so a revision
 * the `integer` column cannot hold is the same refusal from the store and from the in-memory one, never a database
 * failure from one and a conflict from the other.
 *
 * @param what the thing being written, for the problem text
 * @returns the problem, or `undefined` when the revision is one a row could carry and the next one fits
 */
export function writeRevisionProblem({
  expectedRevision,
  what,
}: {
  expectedRevision: number | null;
  what: string;
}): string | undefined {
  if (expectedRevision === null) {
    return undefined;
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > STORE_INTEGER_MAX) {
    return `${what} names revision ${String(expectedRevision)}, which no stored row carries`;
  }
  if (expectedRevision === STORE_INTEGER_MAX) {
    return `${what} is at revision ${expectedRevision}, the store's largest, so it cannot be written again`;
  }
  return undefined;
}

/**
 * Whether a calendar date `YYYY-MM-DD` falls in a year PostgreSQL's `date` holds as written: year 0000 parses in
 * JavaScript (it is 1 BC) and the column refuses it.
 *
 * @returns true when its year is 0001 or later
 */
export function isStorableDate({ date }: { date: string }): boolean {
  return !date.startsWith("0000");
}

/**
 * Every string inside a value, keys included, that PostgreSQL would refuse or alter.
 *
 * @param value an aggregate, a detail document or the register document
 * @param path where `value` sits, for the problem text
 * @returns the path of each offending string, in walk order
 */
export function unstorableStrings({ path, value }: { path: string; value: unknown }): readonly string[] {
  if (typeof value === "string") {
    return unstorable({ text: value }) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unstorableStrings({ path: `${path}[${index}]`, value: item }));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(unstorable({ text: key }) ? [`${path} key ${JSON.stringify(key)}`] : []),
      ...unstorableStrings({ path: `${path}.${key}`, value: item }),
    ]);
  }
  return [];
}

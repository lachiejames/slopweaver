/**
 * Reading ONE field out of an untyped journal payload — the five accessors {@link ./ledger}'s per-kind
 * decoders are built from.
 *
 * Their own file because they are a seam rather than a slice: none of them mentions `RunEvent` or any other
 * ledger type, none can fail, and every one of them encodes a decision about what an ABSENT or malformed
 * field means, which is the thing worth reading in one place. The distinction between {@link count} and
 * {@link optionalCount} is the worked example — collapsing a missing number to 0 is right for a tally and
 * wrong for a pid.
 *
 * Pure: no filesystem, no clock.
 */

/**
 * A string field, or the empty string — a malformed field must not make the whole entry vanish.
 *
 * @param payload the decoded JSON object
 * @param key the field to read
 * @returns the string, or `""` when absent or not a string
 */
export function text({ payload, key }: { payload: Readonly<Record<string, unknown>>; key: string }): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

/**
 * A count field: any finite number, as written — a negative one included, because every checkout on the
 * machine reads the same shared journals and tightening this reader would refuse rows already written.
 *
 * @param payload the decoded JSON object
 * @param key the field to read
 * @returns the number, or `0` when absent or not a finite number
 */
export function count({ payload, key }: { payload: Readonly<Record<string, unknown>>; key: string }): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * A number field that may legitimately be ABSENT, kept distinct from zero.
 *
 * {@link count} collapses a missing field to 0, which is right for a tally and wrong for a pid: pid 0 is a
 * claim about a process, and printing it in a refusal would send the reader looking for something that was
 * never recorded.
 *
 * @param payload the decoded JSON object
 * @param key the field to read
 * @returns the number, or `undefined` when it is genuinely absent
 */
export function optionalCount({
  payload,
  key,
}: {
  payload: Readonly<Record<string, unknown>>;
  key: string;
}): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A string field that may legitimately be absent — the empty string is not a usable path or identifier.
 *
 * @param payload the decoded JSON object
 * @param key the field to read
 * @returns the trimmed-non-empty string, or `undefined`
 */
export function optionalText({
  payload,
  key,
}: {
  payload: Readonly<Record<string, unknown>>;
  key: string;
}): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * A list-of-strings field, tolerating absence.
 *
 * @param payload the decoded JSON object
 * @param key the field to read
 * @returns the string members, in order; empty when the field is absent or not an array
 */
export function stringList({
  payload,
  key,
}: {
  payload: Readonly<Record<string, unknown>>;
  key: string;
}): readonly string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}

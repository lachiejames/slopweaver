/** Small type-narrowing predicates shared across the CLI spine. Pure: no I/O, no state. */

/**
 * Whether a value is a plain object — the narrowing every defensive parser here starts from.
 *
 * @param value the value to narrow
 * @returns true for a non-null, non-array object. Positional because TS1230 forbids destructuring in a
 *   type predicate, which is a documented exception to the named-object rule
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a value is a plain record whose values are ALL numbers — narrower than {@link isRecord} alone
 * proves, for the common "reason/cluster → count" map shape.
 *
 * @param value the value to narrow
 * @returns true for a plain object every one of whose own values is a number. Positional for the same
 *   TS1230 reason as {@link isRecord}
 */
export function isRecordOfNumbers(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");
}

/**
 * Whether a string is one of an allowed set, narrowing it to that union.
 *
 * @param value the string to narrow
 * @param allowed the permitted values
 * @returns true when `value` is one of them. Positional for the same TS1230 reason as {@link isRecord}
 */
export function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((item) => item === value);
}

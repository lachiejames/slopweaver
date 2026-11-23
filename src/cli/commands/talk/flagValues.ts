/**
 * Reading one flag's value for the `talk` verbs: as a string, with a stated default, as a count, and the
 * spec's own flag list for the help-truth ratchet. Its own module so `args.ts` holds the verbs' contracts
 * and nothing else.
 */
import type { FlagSpec } from "../../parseFlags.js";

/**
 * A flag's value as a non-empty string.
 *
 * @returns the value, or undefined when it was absent, empty or a bare boolean
 */
export function stringOf({ value }: { value: string | boolean | undefined }): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * A flag's value, or the stated default when the flag was absent.
 *
 * Written as an `if` that returns rather than as a ternary, for the reason `hand/deps.ts` carries: the
 * house rule bans `??`, and oxlint's `prefer-nullish-coalescing` rewrites the ternary straight back into
 * one. The absent case named in its own branch satisfies both.
 *
 * @param fallback what an absent flag means, which is always a constant here and never another read
 * @returns the flag's value, or the fallback
 */
export function stringOr({ value, fallback }: { value: string | boolean | undefined; fallback: string }): string {
  const held = stringOf({ value });
  if (held === undefined) {
    return fallback;
  }
  return held;
}

/**
 * A flag's value as a non-negative integer, recording a problem rather than guessing at a bad one.
 *
 * @param problems the parse's running list, which a bad value is appended to
 * @returns the count, or the fallback when the flag was absent or bad
 */
export function numberOf({
  value,
  fallback,
  name,
  problems,
}: {
  value: string | boolean | undefined;
  fallback: number;
  name: string;
  problems: string[];
}): number {
  const text = stringOf({ value });
  if (text === undefined) {
    return fallback;
  }
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) {
    problems.push(`${name} must be a non-negative whole number, got ${text}`);
    return fallback;
  }
  return parsed;
}

/**
 * Every flag a spec declares, for the help-truth ratchet.
 *
 * @returns the names, `--`-prefixed and sorted
 */
export function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: booleans = [], string: strings = [] } = spec;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

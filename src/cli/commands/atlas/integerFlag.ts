/**
 * The numeric-flag refusals for the whole `atlas` verb family, in a leaf every parser can reach.
 *
 * Shared rather than written twice, and raised as `AtlasCommandErrors.integerFlagInvalid` (`./errors.ts`) so
 * every parser that reads a whole number refuses it in one sentence. Two parsers phrasing the same refusal two
 * ways was never good for a reader: a caller who mistypes `--cells` and a caller who mistypes `--max-rows`
 * are making the same mistake.
 *
 * `atlas <platform> read`'s `--limit` ({@link parseReadLimit}) deliberately keeps its own sentence: it carries a
 * MAXIMUM as well, and its refusal exists to say which end of the range was crossed.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/**
 * Read a flag whose value must be a whole number at or above a floor.
 *
 * A flag the caller never passed is not a refusal — it takes {@link fallback} — because every caller of
 * this helper has a default and an absent flag is the normal case rather than a mistake.
 *
 * @param raw whatever the parser found under the flag, of whatever type
 * @param name the flag's own name, so a refusal names what the reader typed
 * @param min the smallest value the flag accepts
 * @param fallback the value used when the flag is absent
 * @returns the number, or why it is not one
 */
export function integerFlagAtLeast({
  raw,
  name,
  min,
  fallback,
}: {
  raw: unknown;
  name: string;
  min: number;
  fallback: number;
}): Result<number, AtlasCommandError> {
  if (typeof raw !== "string") {
    return ok(fallback);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    return err(AtlasCommandErrors.integerFlagInvalid({ min, name, raw }));
  }
  return ok(parsed);
}

/** The lowest and highest `--limit` the verb accepts, matching `kit/read.ts`'s own clamp. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 1000;

/**
 * Parse a `--limit` value, refusing anything that is not a whole number in range.
 *
 * A silent clamp would be worse than a refusal here: a caller who typed `--limit 5000` wants to know the
 * page they got back is not the page they asked for, and a truncated result that says nothing is exactly
 * the shape a consumer quotes as complete.
 *
 * @param raw the flag's raw string value
 * @returns the parsed limit, or why it was refused
 */
export function parseReadLimit({ raw }: { raw: string }): Result<number, AtlasCommandError> {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < LIMIT_MIN || value > LIMIT_MAX) {
    return err(AtlasCommandErrors.readLimitInvalid({ max: LIMIT_MAX, min: LIMIT_MIN, raw }));
  }
  return ok(value);
}

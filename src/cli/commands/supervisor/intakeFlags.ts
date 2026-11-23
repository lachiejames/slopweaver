/**
 * The two flag-tail helpers `supervisor intake` (`./intakeRun.ts`) and `supervisor intake-mark` (`./intakeMarkRun.ts`)
 * share — a leaf, so neither verb loads the other's reads to get them.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_USAGE } from "../../exitCodes.js";

/**
 * Whether a flag value parses as an instant, so a mistyped `--since` refuses rather than reading everything.
 *
 * @param name the flag's name, without its dashes
 * @param value the flag's value, absent when it was not passed
 * @returns the rejection, or `undefined` when the value is absent or an instant
 */
export function instantProblem({ name, value }: { name: string; value: string | undefined }): string | undefined {
  if (value === undefined || !Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return `--${name} ${value} is not an instant`;
}

/**
 * Print the rejections and the usage line.
 *
 * @param errors every rejection the parse found
 * @param usage the verb's usage text
 * @returns the usage exit code, so a verb can return the refusal directly
 */
export function refuse({ errors, usage }: { errors: readonly string[]; usage: string }): number {
  errors.forEach((message) => {
    logger.error({ msg: message });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

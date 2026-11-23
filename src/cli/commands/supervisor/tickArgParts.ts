/**
 * The argument pieces every `supervisor tick` subaction's parser shares: a missing required flag, and a tick number.
 * Their own leaf so `./tickCore.ts` and `./tickFillArgs.ts` both read them without importing each other.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ScratchError, ScratchErrors } from "../../../supervisor/scratch/errors.js";

/**
 * The refusal for a required flag that was not passed.
 *
 * @param flag the flag, without its `--`
 * @param subaction the subaction that requires it
 * @returns the usage error
 */
export function missing({ flag, subaction }: { flag: string; subaction: string }): ScratchError {
  return ScratchErrors.usage({ message: `tick ${subaction}: --${flag} is required` });
}

/**
 * A `--tick` or `--carry-from` value as a tick number.
 *
 * @param raw the flag's value, when passed
 * @returns the number, undefined when absent, or a usage refusal
 */
export function tickNumberOf({ raw }: { raw: string | undefined }): Result<number | undefined, ScratchError> {
  if (raw === undefined) {
    return ok(undefined);
  }
  if (!/^[1-9]\d{0,6}$/u.test(raw)) {
    return err(ScratchErrors.usage({ message: `--tick ${raw} must be a positive whole number` }));
  }
  return ok(Number(raw));
}

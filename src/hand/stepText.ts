/**
 * The capped-text check every free-text field of a hand step shares — its sentence, its address, its settling
 * command and its stamps — so `./step.ts` and `./stepAddress.ts` refuse an over-long field in one voice.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";

/**
 * Check one required text field against its cap.
 *
 * @param field the field's name, as it appears in the refusal
 * @param value what the caller supplied
 * @param cap the field's own ceiling
 * @returns the trimmed value, or the refusal
 */
export function requiredText({
  field,
  value,
  cap,
}: {
  field: string;
  value: string;
  cap: number;
}): Result<string, HandStepError> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(HandStepErrors.invalidField({ field, why: "is required and was empty" }));
  }
  if (trimmed.length > cap) {
    return err(
      HandStepErrors.invalidField({
        field,
        why: `is ${String(trimmed.length)} characters and the cap is ${String(cap)} — it is refused rather than truncated, because a surface that trims a step silently shows the owner half an instruction`,
      }),
    );
  }
  return ok(trimmed);
}

/**
 * Check one optional text field against its cap, dropping it when it was not supplied.
 *
 * @param field the field's name, as it appears in the refusal
 * @param value what the caller supplied, or `undefined`
 * @param cap the field's own ceiling
 * @returns the trimmed value, `undefined` when absent, or the refusal
 */
export function optionalText({
  field,
  value,
  cap,
}: {
  field: string;
  value: string | undefined;
  cap: number;
}): Result<string | undefined, HandStepError> {
  if (value === undefined || value.trim().length === 0) {
    return ok(undefined);
  }
  return requiredText({ cap, field, value });
}

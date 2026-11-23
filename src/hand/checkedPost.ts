/**
 * A `hand post` line a seat hands the chair, put through every pure posting rule first — the one tail every
 * composer of such a line shares (`adcSignin.ts`, `midState.ts`), so a line no rule refuses is the only kind a seat
 * ever prints, and a new posting rule reaches every composer at once.
 */
import { err, ok, type Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import type { HandStepError } from "./errors.js";
import { postingRefusal } from "./posting.js";
import { buildHandStep, type HandStepDraft } from "./step.js";

/** A checked command, as argv and as one pasteable line. */
export interface CheckedPostLine {
  readonly argv: readonly string[];
  readonly line: string;
}

/**
 * Build the step the argv would post and ask every pure posting rule of it, before the line is printed.
 *
 * @param draft the step exactly as `hand post` would record it from `argv`
 * @param argv the `slopweaver hand post …` invocation the chair will run
 * @returns the argv and its pasteable line, or the first rule that refused the step
 */
export function checkedPostLine({
  draft,
  argv,
}: {
  draft: HandStepDraft;
  argv: readonly string[];
}): Result<CheckedPostLine, HandStepError> {
  const built = buildHandStep({ draft });
  if (built.isErr()) {
    return err(built.error);
  }
  const refused = postingRefusal({ step: built.value });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok({ argv, line: shellCommandLine({ command: argv }) });
}

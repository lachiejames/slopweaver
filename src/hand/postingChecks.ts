/**
 * The checks every posted hand row meets under the register's lock, whichever writer posts it — the posting form,
 * a plan sign-in's email, and one open card per board row.
 *
 * Pure over what the lock-holder already read, so `./store.ts` and `./multiAppend.ts` both run the same checks
 * without either owning the other's append.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { type PlanEmail, planSignInGap, planSignInGapLine } from "./planSignIn.js";
import { postingRefusal } from "./posting.js";
import { type HandRow, openHandSteps } from "./row.js";
import type { HandStep } from "./step.js";

/**
 * The line numbers of every register line the reader skipped, for {@link HandStepErrors.registerIncomplete}.
 *
 * @param unparsed what the read carried out
 * @returns the line numbers it names, in order
 */
export function skippedLines({ unparsed }: { unparsed: readonly HandStepError[] }): readonly number[] {
  return unparsed.flatMap((error) => (error.code === "CORRUPT_ROW" ? [error.lineNumber] : []));
}

/**
 * The refusal a posting that names a board row meets when another open step already names it — one open card
 * per row — or when the register skipped a line, so absence of that other card cannot be proven.
 *
 * Run for EVERY posted row whatever its writer, like the posting form: a caller that is not `hand post` must
 * not be the road a second card for one row takes. A step naming no row (`--standalone`, and every monitor
 * step) passes untouched.
 *
 * @param step the step about to be posted
 * @param rows what the register held when the lock was taken
 * @param unparsed the lines that read skipped
 * @param replacing the one open step this posting settles in the same append, which does not count
 * @returns the refusal, or ok when the row is free
 */
function rowRefusal({
  step,
  rows,
  unparsed,
  replacing,
}: {
  step: HandStep;
  rows: readonly HandRow[];
  unparsed: readonly HandStepError[];
  replacing: string | undefined;
}): Result<void, HandStepError> {
  if (step.row === undefined) {
    return ok(undefined);
  }
  if (unparsed.length > 0) {
    return err(HandStepErrors.registerIncomplete({ lineNumbers: skippedLines({ unparsed }) }));
  }
  const holder = openHandSteps({ rows }).find(
    (open) => open.row === step.row && open.id !== step.id && open.id !== replacing,
  );
  if (holder === undefined) {
    return ok(undefined);
  }
  return err(HandStepErrors.rowAlreadyOpen({ existingId: holder.id, row: step.row }));
}

/**
 * The posting form's refusal first, then a plan sign-in's email, then the row's — the checks every posted row meets
 * under the lock.
 *
 * The plan check reads the note as the owner does, `what` and `where` together (`./planSignIn.ts`), and needs the register's
 * addresses, which is why it sits here beside the row check rather than in the step-only posting form.
 *
 * @param step the step about to be posted
 * @param rows what the register held when the lock was taken
 * @param unparsed the lines that read skipped
 * @param replacing the one open step this posting settles in the same append
 * @param plans every registered plan's alias and cached address, for a sign-in naming one
 * @returns the first refusal, or ok when the posting may be written
 */
export function postingOrRowRefusal({
  step,
  rows,
  unparsed,
  replacing,
  plans,
}: {
  step: HandStep;
  rows: readonly HandRow[];
  unparsed: readonly HandStepError[];
  replacing: string | undefined;
  plans: readonly PlanEmail[];
}): Result<void, HandStepError> {
  const form = postingRefusal({ step });
  if (form !== undefined) {
    return err(form);
  }
  const gap = planSignInGap({ plans, text: [step.what, step.where].filter((part) => part !== undefined).join("\n") });
  if (gap !== undefined) {
    return err(HandStepErrors.invalidField({ field: "what", why: planSignInGapLine({ gap }) }));
  }
  return rowRefusal({ replacing, rows, step, unparsed });
}

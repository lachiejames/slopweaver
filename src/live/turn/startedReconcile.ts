/**
 * Which `started` checklist ref a brief carries, when a caller's explicit flags and the durable ask-lifecycle
 * log may each name one. Pure, and separate from `./brief.ts` because it decides an input to the brief rather
 * than anything the brief renders.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { StartedChecklist } from "../ask/checklist.js";
import { type StartedChecklistMismatchError, StartedChecklistMismatchErrors } from "./errors.js";

/** Two `StartedChecklist` values name the same checklist message. Pure structural equality. */
function sameStartedChecklist({ left, right }: { left: StartedChecklist; right: StartedChecklist }): boolean {
  return left.turnId === right.turnId && left.workingTs === right.workingTs;
}

/**
 * Reconcile the `started` ref a caller passed explicitly against the one recorded in the durable
 * ask-lifecycle log, so an explicit-but-stale-or-wrong pair can never silently win over the truth.
 *
 * Both present and equal, or only one present, both resolve cleanly — lifecycle persistence is deliberately
 * best-effort (see `../../cli/commands/listen/run.ts`'s `withChecklistPostedLifecycle`), so "only the ledger
 * has it" and "only the flags have it" are both ordinary, expected shapes, not a fault. Both present and
 * DIFFERENT is the one shape this refuses outright, before a brief is ever written: advancing the wrong
 * Slack message in place is worse than refusing to brief the ask at all.
 *
 * @param explicit the `--turn-id`/`--working-ts` pair the caller passed, when it passed one
 * @param recorded the ref `startedRefForAsk` recovered from the durable log, when one exists
 * @returns the ref to use, or the refusal naming the exact mismatch
 */
export function reconcileStartedChecklist({
  explicit,
  recorded,
}: {
  explicit: StartedChecklist | undefined;
  recorded: StartedChecklist | undefined;
}): Result<StartedChecklist | undefined, StartedChecklistMismatchError> {
  if (explicit === undefined) {
    return ok(recorded);
  }
  if (recorded === undefined) {
    return ok(explicit);
  }
  if (sameStartedChecklist({ left: explicit, right: recorded })) {
    return ok(explicit);
  }
  return err(StartedChecklistMismatchErrors.mismatch({ explicit, recorded }));
}

/**
 * ONE PLAN PER TURN — whether an answer may still declare `followThrough`, as a pure decision.
 *
 * A first answer (`../ask/lifecycleEvents.ts`'s `FirstAnsweredEvent`) is the one sanctioned exception to "one
 * answer per turn": a plan, then the final answer. A second plan would be a progress post, and progress posts
 * are not something the owner asked for — so once a first answer stands on the fold, the next post on this
 * ask must be the final one. `turn answer` asks this before anything reaches Slack.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { FirstAnsweredEvent } from "../ask/lifecycleEvents.js";
import { type FirstAnswerStandsError, TurnErrors } from "./turnErrors.js";

/**
 * Whether this answer may be posted given the first answer already standing on the ask, if any.
 *
 * Only a form that declares `followThrough` is ever refused: the final answer over a standing plan is
 * exactly what the plan promised, and an ask with no plan standing may post one.
 *
 * @param declaresFollowThrough whether the answer about to be posted declares `followThrough`
 * @param standing the ask's standing first answer from the fold, or `undefined` when none stands
 * @returns ok, or the typed refusal naming the plan already posted
 */
export function followThroughAdmissible({
  declaresFollowThrough,
  standing,
}: {
  declaresFollowThrough: boolean;
  standing: FirstAnsweredEvent | undefined;
}): Result<void, FirstAnswerStandsError> {
  if (!declaresFollowThrough || standing === undefined) {
    return ok(undefined);
  }
  return err(TurnErrors.firstAnswerStands({ answerTs: standing.answerTs, postedIso: standing.tsIso }));
}

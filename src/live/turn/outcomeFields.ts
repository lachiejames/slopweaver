/**
 * The FRAGMENTS a settled turn spreads onto its outcome — one per courtesy effect that can fail without ending
 * the turn: the checklist that would not resolve, the status indicator that would not set or clear, and the
 * earlier cards a posted answer could not reap, and the answer a CORRECTION superseded that would not come
 * down.
 *
 * Split out of `./run.ts` along that seam: `runTurn` decides the ORDER effects happen in, and each function
 * here decides only what one effect's failure looks like on the durable completion (`./envelope.ts`).
 */
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";
import type { AskIdentity } from "../ask/identity.js";
import { reapEarlierCards } from "./earlierCards.js";
import type { TurnHandlerOutcome } from "./envelope.js";
import type { PostedRef, TurnPoster, TurnSupersession } from "./runContract.js";
import type { SupersessionReport } from "./supersession/run.js";

/**
 * The reason reported when neither {@link TurnPoster.deleteWorking} nor its {@link TurnPoster.finalizeWorking}
 * fallback could resolve the working checklist.
 *
 * Named with the message it left stuck, so an operator reading this in the log has enough to go delete it
 * by hand rather than just knowing something, somewhere, went wrong.
 *
 * @param posted the working message that could not be resolved
 * @returns the failure line, naming the channel and timestamp to delete
 */
function checklistStuckMessage({ posted }: { posted: PostedRef }): string {
  return (
    `the working checklist in ${posted.channel} (ts ${posted.ts}) could not be resolved — it may still show ` +
    "unfinished steps above the posted answer; delete it by hand"
  );
}

/**
 * The `{}` or `{ checklistFailure }` fragment an outcome spreads on, given whether the checklist resolved.
 *
 * @param posted the working message
 * @param resolved whether either terminal path settled it
 * @returns the fragment
 */
export function checklistOutcomeFields({ posted, resolved }: { posted: PostedRef; resolved: boolean }): {
  readonly checklistFailure?: string;
} {
  return resolved ? {} : { checklistFailure: checklistStuckMessage({ posted }) };
}

/**
 * The `{}` or `{ statusFailure }` fragment an outcome spreads on, given every indicator failure collected.
 *
 * @param failures every set and clear refusal, in order
 * @returns the fragment
 */
export function statusOutcomeFields({ failures }: { failures: readonly string[] }): {
  readonly statusFailure?: readonly string[];
} {
  return failures.length === 0 ? {} : { statusFailure: failures };
}

/**
 * Reap every earlier card once — and only once — the turn's answer actually posted, as the `{}` or
 * `{ reapFailure }` fragment. A withheld, failed or answer-lost turn replaced nothing, so it reaps nothing.
 *
 * @param cards every card an earlier turn on this ask left, from `./earlierCards.ts`
 * @param outcome the settled outcome, which says whether an answer posted and where
 * @param poster the seam each delete goes through
 * @param workingTs this turn's own working message, never reaped here
 * @returns the fragment
 */
export async function reapOutcomeFields({
  cards,
  outcome,
  poster,
  workingTs,
}: {
  cards: readonly PostedRef[];
  outcome: TurnHandlerOutcome;
  poster: Pick<TurnPoster, "reapEarlierCard">;
  workingTs: string;
}): Promise<{ readonly reapFailure?: readonly string[] }> {
  if (!outcome.answered || outcome.answerTs === undefined) {
    return {};
  }
  const reapFailure = await reapEarlierCards({ answerTs: outcome.answerTs, cards, poster, workingTs });
  return reapFailure.length === 0 ? {} : { reapFailure };
}

/**
 * The one line a turn reports when a declared supersession did not end in a clean delete.
 *
 * It names the message, the domain code and the reason in that order, because the three answer three
 * different questions a reader has in that order: WHICH message is still standing, WHY the mechanism said
 * no, and what to do about it. `unconfirmed` gets its own sentence rather than the refusal wording — the
 * delete was entered, so the message may be gone, and telling an operator to go remove something that is
 * already removed is the same class of confident wrong as telling them nothing.
 *
 * A REMOVED message gets a third sentence for the same reason. It reaches here only carrying a code — the
 * journal append that failed after the delete succeeded — and the two sentences above would both tell an
 * operator to go and look at a message that is not there any more.
 */
function supersessionStuckMessage({ channel, report }: { channel: string; report: SupersessionReport }): string {
  const { targetTs = "(no timestamp on the report)" } = report;
  const { code = "(no code on the report)" } = report;
  const { detail = "(no detail on the report)" } = report;
  const where = `${channel} (ts ${targetTs})`;
  if (report.outcome === "deleted" || report.outcome === "already-gone") {
    return `the answer this turn superseded in ${where} came down, and something around the delete did not — ${code}: ${detail}`;
  }
  if (report.outcome === "unconfirmed") {
    return (
      `the answer this turn superseded in ${where} may or may not have come down — the delete was sent and ` +
      `never confirmed (${code}: ${detail}); check the thread before deleting it by hand`
    );
  }
  return `the answer this turn superseded in ${where} is still standing — ${code}: ${detail}`;
}

/**
 * Settle the supersession this turn declared, ONLY once its own answer actually posted, as the `{}` or
 * `{ supersessionFailure }` fragment.
 *
 * **The guard is the safety property, not a tidiness.** A withheld, failed or answer-lost turn put nothing
 * in the thread to replace the target with, so deleting it would leave the ask with neither answer standing
 * — the one outcome that is strictly worse than the stale answer this whole mechanism exists to remove. It
 * is the same guard {@link reapOutcomeFields} applies for the same reason, and it lives HERE rather than
 * inside the seam because whether an answer posted is a fact about the turn, which the seam cannot see.
 *
 * A clean delete and an additive turn both report `{}`: there is nothing for a reader to act on in either,
 * and the supersession's own journal (`./supersession/store.ts`) is where the positive record lives.
 *
 * @param askIdentity the ask this correction answered, which bounds the whole act
 * @param declaredTs the `supersedes` timestamp off the answer form, absent on an additive turn
 * @param postedAnswer the composed answer, absent when the query never produced one
 * @param outcome the settled outcome, which says whether an answer posted and where
 * @param settle the injected seam that decides and performs it
 * @param turnId the turn doing the superseding, so the journal names the work
 * @returns the fragment
 */
export async function supersessionOutcomeFields({
  askIdentity,
  declaredTs,
  outcome,
  postedAnswer,
  settle,
  turnId,
}: {
  askIdentity: AskIdentity;
  declaredTs: string | undefined;
  outcome: TurnHandlerOutcome;
  postedAnswer: AnswerFormAnswer | undefined;
  settle: TurnSupersession;
  turnId: string;
}): Promise<{ readonly supersessionFailure?: string }> {
  const answerTs = outcome.answerTs;
  // `postedAnswer` joins the same guard rather than earning its own: a turn whose query never produced an
  // answer posted nothing, so it is the identical fact the two conditions beside it already state, and the
  // seam needs the form to bind the warrant to what actually went out.
  if (!outcome.answered || answerTs === undefined || postedAnswer === undefined) {
    return {};
  }
  const report = await settle({ askIdentity, declaredTs, postedAnswer, postedAnswerTs: answerTs, turnId });
  if (report.outcome === "not-declared") {
    return {};
  }
  const removed = report.outcome === "deleted" || report.outcome === "already-gone";
  // A clean removal reports nothing — there is nothing for a reader to act on. But a removal carrying a CODE
  // is not clean: the delete worked and something around it did not, the journal append being the case that
  // exists. Dropping it on the outcome alone is how that failure left no trace anywhere at all.
  if (removed && report.code === undefined) {
    return {};
  }
  return { supersessionFailure: supersessionStuckMessage({ channel: askIdentity.channel, report }) };
}

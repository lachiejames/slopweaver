/**
 * Running the session's query while the status keeps moving.
 *
 * **Ordering 1** of the list in {@link ./run}: the working message is posted before the query starts,
 * because the query takes tens of seconds and latency with no acknowledgement reads as a dead bot. This
 * module is the other half of that, keeping the indicator alive for the whole wait rather than letting it
 * go stale while the session thinks.
 *
 * No query here ever loads the corpus. {@link ./runContract.TurnQuery} arrives already satisfied by the
 * session, so there is no corpus-touching adapter left to mis-default.
 */

import { err, ok, type Result } from "../../lib/result.js";
import { turnChecklist } from "./answer.js";
import { type TurnIndicatorSeams, terminalChecklistProgress } from "./indicators.js";
import {
  type PostedRef,
  TURN_STATUS_TEXT,
  type TurnPoster,
  type TurnQuery,
  type TurnQueryOutcome,
  type TurnStep,
} from "./runContract.js";
import { advance, type Cursor, reasonOf } from "./turnCursor.js";

/**
 * What running the query under the status indicator produced, plus whatever the indicator itself reported.
 *
 * `statusFailure` sits OUTSIDE the result rather than on each arm: the indicator's own refusal is orthogonal
 * to whether the query answered, and both arms carried it identically when this was a hand-rolled union.
 */
export type StatusedQuery = {
  readonly query: Result<TurnQueryOutcome, unknown>;
  readonly statusFailure: readonly string[];
};

/**
 * Run the query bracketed by the native status indicator: set BEFORE, clear AFTER — on both the success and
 * the failure path. Split out of {@link runTurn} to keep the ordering it encodes legible on its own: the
 * indicator is set right before the one span it exists to cover, and cleared the moment the turn has
 * anything else to show, in either direction.
 *
 * Never rejects on the indicator's own account — a refusal from `beginStatus` is carried out as
 * `statusFailure` rather than thrown, same posture as the title above it.
 *
 * @returns what the query produced, plus whatever the indicator itself refused on the way in or out
 */
export async function runQueryUnderStatus({
  cursor,
  poster,
  posted,
  query,
  question,
  steps,
  task,
}: {
  cursor: Cursor;
  poster: TurnPoster;
  posted: PostedRef;
  query: TurnQuery;
  question: string;
  steps: readonly TurnStep[];
  task: string;
}): Promise<StatusedQuery> {
  // Wrapped, because a REFUSAL and a THROW are different failures and only the first was handled. The poster
  // turns a Slack refusal into `{ reason }`, but a transport fault — an ECONNRESET with no `error.data` — is
  // rethrown, and this await sits outside the try below. An adversarial review found that a courtesy signal
  // failing that way killed the turn before it ever ran the query: the tag got no answer at all because the
  // bot could not say it was thinking. The signal is never worth the product.
  const statusStarted = await poster
    .beginStatus({ status: TURN_STATUS_TEXT })
    .catch((cause: unknown) => err(cause instanceof Error ? cause.message : String(cause)));
  // A COMPLETE sentence, not a fragment. Its sibling below says "was not cleared", and the caller logs each
  // verbatim — an adversarial review caught the CLI prefixing both with "was not set", which read "not set —
  // not cleared" and told the reader the opposite of what happened.
  const setFailure = statusStarted.isOk() ? undefined : `the thinking indicator was not set — ${statusStarted.error}`;
  try {
    const outcome = await query({
      onPhase: async ({ detail }) => advance({ cursor, detail, posted, poster, steps, task }),
      question,
    });
    return { query: ok(outcome), statusFailure: setFailure === undefined ? [] : [setFailure] };
  } catch (error) {
    // NOT cleared here any more. Clearing the indicator is finalisation's job on EVERY terminal path, and
    // doing it here as well meant this one path cleared it twice while the refused path cleared it never —
    // which is the split `./indicators.ts` exists to close. The SET refusal is still carried out, because it
    // happened before any of that and nothing downstream can rediscover it.
    return { query: err(error), statusFailure: setFailure === undefined ? [] : [setFailure] };
  }
}

/**
 * Build the turn's live indicators as the never-throwing seams {@link finaliseIndicators} takes.
 *
 * Every method is total: `endStatus` and `settleReaction` turn a transport fault into a reason (the poster
 * already turns a SLACK refusal into one, but rethrows a genuine fault such as an ECONNRESET), and
 * `finalizeWorking` reports its own failure as `false` rather than throwing. That is what lets finalisation
 * run on a path that is ALREADY handling a failure without inventing a second one.
 *
 * The answered case tries {@link TurnPoster.deleteWorking} first and falls back to the terminal frame, which
 * is the ordering `deliverAnswer` used to own inline: a real answer REPLACES the working message rather than
 * ticking it, and only a failed delete leaves a finished checklist standing in its place.
 *
 * @param cursor the turn's mutable position in its own checklist
 * @param posted the working message this turn is editing, absent when none was ever posted
 * @param poster what the turn may post
 * @param steps the checklist this tier actually takes
 * @param task the bracketed task label on the author row
 * @returns the three seams, each total
 */
export function turnIndicatorSeams({
  cursor,
  posted,
  poster,
  steps,
  task,
}: {
  cursor: Cursor;
  posted?: PostedRef | undefined;
  poster: TurnPoster;
  steps: readonly TurnStep[];
  task: string;
}): TurnIndicatorSeams {
  return {
    endStatus: async () => poster.endStatus().catch((cause: unknown) => err(reasonOf({ error: cause }))),
    settleChecklist: async ({ checklist }) => {
      // No card was ever posted, so there is nothing standing to correct — which is settled, not stuck.
      if (posted === undefined) {
        return true;
      }
      if (checklist.kind === "done" && (await poster.deleteWorking({ posted }).catch(() => false))) {
        return true;
      }
      const progress = terminalChecklistProgress({
        checklist,
        completed: cursor.completed,
        details: cursor.details,
        stepCount: steps.length,
      });
      cursor.completed = progress.completed;
      return poster.finalizeWorking({ posted, steps: turnChecklist({ progress, steps }), task });
    },
    settleReaction: async ({ reaction }) =>
      poster.settleReaction({ reaction }).catch((cause: unknown) => err(reasonOf({ error: cause }))),
  };
}

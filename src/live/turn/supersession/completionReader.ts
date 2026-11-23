/**
 * Which answers THIS installation can prove it posted — the completion log, projected for a supersession.
 *
 * The one input that makes a supersession safe rather than plausible. An answer timestamp a composer wrote
 * into a form is a claim; a `turn-completed` row naming that timestamp, with the ask identity it was
 * answering, is this program's own record of having posted it. Everything downstream compares against what
 * comes out of here.
 *
 * ## It is a PROJECTION, not a second parser
 *
 * `../completionLog.ts`'s `parseTurnCompletionLog` already reads that log, and reading it a second way here is
 * the exact shape of the dedup defect `.claude/rules/error-handling.md` records against a dedup refactor — two
 * readers of one file drift, and the one a destructive act consults is the worse half to have drifted. So
 * this module takes that function's output and narrows it: the `answered` arm only, with an
 * {@link AskIdentity} re-validated field by field rather than accepted as the bare record the envelope's own
 * guard settles for, because a correction compares channel and thread and an identity missing either is not
 * something to compare against.
 *
 * ## Strict, and what that costs
 *
 * A row this projection drops is reported downstream as `NO_SUCH_ANSWER`, which reads as "we never posted
 * that" when the truth may be "we cannot read our own record of posting that". Both end in the same act —
 * nothing is deleted — so a misparse falls on the conservative side, which is why the distinction is
 * allowed to collapse here and nowhere else.
 */
import { isSlackTs } from "../../../lib/slackTs.js";
import { type AskIdentity, isAskIdentity } from "../../ask/identity.js";
import { parseTurnCompletionLog } from "../completionLog.js";
import type { TurnCompletionEvent } from "../envelope.js";

/** One answer this installation recorded itself posting, reduced to the fields a supersession judges. */
export interface AnsweredPredecessor {
  /** The ask the answer was answering — the channel and thread a correction must match. */
  readonly askIdentity: AskIdentity;
  /** The turn that posted it, carried so a journal row names the work rather than only the message. */
  readonly turnId: string;
  /** The posted answer's own Slack timestamp. */
  readonly answerTs: string;
  /** When the completion was appended — the instant an edit is judged "since". */
  readonly recordedIso: string;
}

/** One event narrowed to an answered predecessor, or `undefined` when it is not one this reader trusts. */
function predecessorOf({ event }: { event: TurnCompletionEvent }): AnsweredPredecessor | undefined {
  const { completion } = event;
  if (completion.primary.kind !== "answered" || !isSlackTs({ ts: completion.primary.answerTs })) {
    return undefined;
  }
  if (!isAskIdentity(completion.askIdentity) || Number.isNaN(Date.parse(event.tsIso))) {
    return undefined;
  }
  return {
    answerTs: completion.primary.answerTs,
    askIdentity: completion.askIdentity,
    recordedIso: event.tsIso,
    turnId: completion.turnId,
  };
}

/**
 * Every answered turn in one completion log, oldest first.
 *
 * @param text the raw log contents — the empty string for a home with no completed turns
 * @returns one entry per readable answered completion, in the order they were appended
 */
export function answeredPredecessors({ text }: { text: string }): readonly AnsweredPredecessor[] {
  const found: AnsweredPredecessor[] = [];
  for (const event of parseTurnCompletionLog({ text }).events) {
    const predecessor = predecessorOf({ event });
    if (predecessor !== undefined) {
      found.push(predecessor);
    }
  }
  return found;
}

/**
 * The answer recorded at one exact timestamp, when this installation recorded posting one.
 *
 * The LAST match wins, which matters only in the impossible case of two rows naming one Slack timestamp;
 * taking the latest is how every other reader of an append-only log here resolves a duplicate key.
 *
 * @param predecessors every answered completion, as {@link answeredPredecessors} returns them
 * @param answerTs the timestamp a correction declares it supersedes
 * @returns the recorded answer, or `undefined` when nothing recorded one there
 */
export function predecessorAt({
  predecessors,
  answerTs,
}: {
  predecessors: readonly AnsweredPredecessor[];
  answerTs: string;
}): AnsweredPredecessor | undefined {
  return predecessors.findLast((entry) => entry.answerTs === answerTs);
}

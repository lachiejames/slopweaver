/**
 * Whether a message of the thinking model's is the same answer again: a turn that already answered the owner writes
 * another answer with nothing new of theirs to answer, and the voice would say it a second time in other words.
 *
 * What the owner hears otherwise is the same thing said twice in two different ways. What causes it: the spoken record
 * (`./talkPlanSteer.ts`) is steered into the RUNNING turn a second time — the voice's own "On it." finishing after the
 * turn began, or the owner's question's transcript closing after the voice handed it off — and a steer arriving after
 * the turn has answered makes the thinking model answer again. Both answers are handed to the voice, which says both.
 * Measured: after a steer carrying the owner's question again, one turn wrote two answers 5.4s apart, and the voice
 * said both. Repro: `grep -n <turn-id> $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl` — two `spoken-record` steers, two
 * `wrote` lines, two hand-offs.
 *
 * MEASURED over every call file kept at the time: 73 turns handed the voice two or more answers, 76
 * later answers in all, and only 1 followed an utterance of the owner's that began after its turn started and finished before
 * it was written. A sample of 12 of the other pairs each read as one answer said twice. Turns handing two or more
 * answers, per day: 5–11% on the earlier days, 19% (31 of 160) on the last; a turn steered twice was 76–100% every day, so
 * the steer is not what is new. In 36 of the 52 such turns in the later window, a line of the owner's closed between the two steers.
 *
 * So a later answer of a turn that already handed the voice one is said only when an utterance of the owner's that
 * BEGAN after that turn started has finished since: words that cannot be their question again. The bar never moves
 * past the turn's start, since what a message could have read is not what it answered. Commentary, blanks and nods are never judged here — `./talkPlanHeldRelease.ts` already drops or keeps them.
 *
 * RESIDUE, stated: a second answer that also carries something the first did not — 3 of those 12 added a "Next is …"
 * after repeating the answer — is dropped with its repeat, so the walk waits on the owner to ask for the next item.
 */
import type { PlanCallEvent } from "./planCallContract";
import { type HeldAnswer, saysSomething } from "./talkPlanHeldRelease";

/** A held message, stamped with the newest of the owner's finished utterances it could have read. */
export interface StampedAnswer extends HeldAnswer {
  /**
   * The call's arrival number at which the owner's newest finished utterance BEGAN, as of this message's arrival:
   * `undefined` before they have finished one.
   */
  readonly heardBeganSeq: number | undefined;
}

/** What one release's messages come to once repeats are taken out. */
export interface RepeatSplit {
  /** The messages still judged by the release, in order. */
  readonly kept: readonly StampedAnswer[];
  /** The answers a turn already gave, said again with nothing new of the owner's to answer. */
  readonly repeats: readonly StampedAnswer[];
  /**
   * Each turn whose answer the kept messages carry, by the arrival number the owner's next words must have begun after
   * for another answer of it to be said — committed only once the voice took a release that carries it, never on a
   * timeout.
   */
  readonly answeredAfter: ReadonlyMap<string, number>;
}

/**
 * Take one release's repeats out: an answer of a turn an earlier taken release already answered is kept only when an
 * utterance of the owner's that began after that turn started has finished since. Two copies held in ONE release are
 * both kept and said joined, as before: every measured repeat came in a release of its own.
 *
 * @param taken the release's messages, oldest first
 * @param answered each turn whose answer an earlier release the voice took carried, by its threshold
 * @param turnStarts each turn whose start the call has seen, by the arrival number of its first start
 * @param superseded whether a message is already dropped for words the owner has moved past, which answers nothing
 * @returns the kept messages, the repeats, and the thresholds the kept answers set
 */
export function splitRepeats({
  taken,
  answered,
  turnStarts,
  superseded,
}: {
  taken: readonly StampedAnswer[];
  answered: ReadonlyMap<string, number>;
  turnStarts: ReadonlyMap<string, number>;
  superseded: (answer: StampedAnswer) => boolean;
}): RepeatSplit {
  const answeredAfter = new Map<string, number>();
  const kept: StampedAnswer[] = [];
  const repeats: StampedAnswer[] = [];
  for (const answer of taken) {
    if (answer.commentary || superseded(answer) || !saysSomething({ answer })) {
      kept.push(answer);
      continue;
    }
    // Only an earlier release's answer is judged against: one release says a turn's messages joined as one answer,
    // and a sign-off split across two of them is cut whole only when both halves are in it.
    const threshold = answered.get(answer.turnId);
    const began = answer.heardBeganSeq;
    if (threshold !== undefined && (began === undefined || began <= threshold)) {
      repeats.push(answer);
      continue;
    }
    // The bar is the turn's start and never moves: a stamp says only which words a message COULD have read, not which
    // it answered, so raising the bar to it drops the answer to words that finished while an earlier message was being
    // written (a repeat of an answer to newer words is said again, failing open). One
    // whose start was never seen, or seen only after it wrote (`turnStarted`'s 0), has nothing to compare with, so it
    // sets none: never a lost answer.
    const start = turnStarts.get(answer.turnId);
    if (threshold === undefined && start !== undefined && start > 0) {
      answeredAfter.set(answer.turnId, start);
    }
    kept.push(answer);
  }
  return { answeredAfter, kept, repeats };
}

/**
 * The bars a taken release commits: only those of turns whose own answer words it said verbatim (`releaseOf`'s
 * `voiced`). A release's `carried` also names a turn whose half of a sign-off split across two TURNS was cut whole,
 * and barring that turn would drop its next answer as a repeat of nothing; judged by structure, never by
 * matching words another turn may share nor by what removing a turn would leave. A turn left out only
 * fails open: its next answer is said.
 *
 * @param answeredAfter the bars the release's split set, by turn
 * @param voiced the messages whose own words the release says
 * @returns the bars of the turns it voiced an answer of
 */
export function voicedBars({
  answeredAfter,
  voiced,
}: {
  answeredAfter: ReadonlyMap<string, number>;
  voiced: readonly HeldAnswer[];
}): [string, number][] {
  const voicedIds = new Set(voiced.filter((h) => !h.commentary).map((h) => h.turnId));
  return [...answeredAfter].filter(([turnId]) => voicedIds.has(turnId));
}

/** The `dropped` event's detail for a repeat. */
export const REPEAT_DETAIL =
  "its turn already answered the owner and nothing they began saying since has finished, so it was the same answer again";

/**
 * The call file's trace of each repeat a split took out — no fault, like a superseded answer, since the turn's first
 * answer is the one the owner was owed.
 *
 * @param split what {@link splitRepeats} came to
 * @returns one `dropped` held-answer event per repeat, pending while the release still hands something over
 */
export function repeatDroppedEvents({ split }: { split: RepeatSplit }): PlanCallEvent[] {
  const pending = split.kept.length > 0;
  return split.repeats.map(({ itemId, turnId }): PlanCallEvent => ({
    detail: REPEAT_DETAIL,
    itemId,
    kind: "held-answer",
    pending,
    phase: "dropped",
    turnId,
  }));
}

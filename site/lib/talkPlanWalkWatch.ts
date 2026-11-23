/**
 * Whether one utterance of the owner's owes the console a walk turn: the owner's final words asked for the next card
 * (`./talkPlanWalkAsk.ts`), no Codex turn runs, and none STARTED while they were speaking. The voice usually hands off
 * before the owner's transcript is final, by about two seconds, and
 * that turn can start and end inside the owner's words, so a running count alone would read a kept hand-off as a dropped one.
 * Every accepted start goes in a set, read as a monotonic count: its size at the owner's utterance's first delta against its
 * size at the `done`. A set, so a replayed start of the same turn never counts twice.
 *
 * A turn that started BEFORE the owner's first delta and ended before the owner's `done` does not answer them, by design: it was handed
 * words they had not yet said, which is the failure's own shape: the voice is saying a finished turn's held answer when
 * they ask. That case is the behaviour, not a gap.
 *
 * Residue, stated: a provider that sends the owner's `done` with no delta before it leaves no baseline, so the count is read
 * at the `done` itself, and a turn that both started and ended before that lone `done` is invisible here.
 */
import { walkAskOf } from "./talkPlanWalkAsk";

/** One call's watch over the owner's utterances for a next-card ask no turn answered. */
export class WalkAskWatch {
  private readonly started = new Set<string>();
  private baseline: number | undefined;

  /**
   * A Codex turn of this call's own thread started and is running.
   *
   * @param turnId the turn's id, counted once however often its start is replayed
   */
  turnStarted({ turnId }: { turnId: string }): void {
    this.started.add(turnId);
  }

  /** A delta of the owner's words: the first of an utterance fixes the count it is judged against. */
  heard(): void {
    if (this.baseline !== undefined) {
      return;
    }
    this.baseline = this.started.size;
  }

  /**
   * The owner's utterance is final: whether it owes the walk turn. Ends the utterance either way.
   *
   * @param text the owner's final transcript, `undefined` when the notification carried none
   * @param running how many Codex turns of this call run now
   * @returns true when the owner's words asked for the next card and no turn started during them or runs now
   */
  done({ text, running }: { text: string | undefined; running: number }): boolean {
    let baseline = this.started.size;
    if (this.baseline !== undefined) {
      baseline = this.baseline;
    }
    this.baseline = undefined;
    return text !== undefined && running === 0 && this.started.size === baseline && walkAskOf({ text });
  }
}

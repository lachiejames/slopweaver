/**
 * A resume over a Codex turn already running: the owner's words came AFTER that turn started, so it never heard them,
 * and the provider left them open. The page judges the silence (`resumeDecisionOf`, `./voiceResumeDecision.ts`); this
 * is the server's half of `PlanCall.resume` for it.
 *
 * Measured on one call: a turn started on the owner's steer and the voice said "Checking, one sec."; the owner's second
 * utterance went quiet and the provider closed it only at "Uh, hello", 40s later. Both halves of the resume refused the
 * whole 40s because a turn was running — the page as `work-in-flight`, this server as `floorRefusal`'s running-turn
 * reason — though that turn had begun before those words, which only a later voice final would hand it. Repro: the
 * `resume-gate` and `cue` lines from the turn's start to the close in `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 *
 * The developer message closes the owner's open turn (measured, `RESUME_TEXT`, `./talkPlanWords.ts`), so its
 * final reaches the running turn as its spoken record (`./spokenRecordQueue.ts`), and the running turn answers. No owed
 * turn is armed: a second `turn/start` beside the running one is not what the owner is owed. Work running on stays a
 * sound, never a spoken line (`PROGRESS_CUE`, `./orbCue.ts`): this acknowledges the
 * owner's words, once per silence, exactly as any resume does.
 *
 * What this half does NOT check, said rather than discovered: delegations, a hand-off and continuations are the
 * page's state alone (`onlyTurnsBegunBefore`, `./voiceResumeDecision.ts`); this server's floor carries no count of
 * them, exactly as on every other resume. So a delegation begun in the milliseconds between the page judging the
 * silence and this post arriving still meets this message. The cost is one
 * "Mm-hm." beside it, never a second turn; closing it would need the page's in-flight set mirrored on the server.
 * A held Codex answer still goes first (`HELD_ANSWERS_REFUSAL`, ahead of the running-turn check, as on main): the
 * answer owed is said in place of this message, whatever the running turns' ages.
 */
import type { PlanFloor } from "./talkPlanFloor";
import { NEVER_HAND_BACK } from "./talkPlanWords";

/**
 * What the voice reads when a resume goes over a running turn: "Mm-hm." and nothing more, since the thinking model
 * already working now has what the owner just said too. Only that word, never "On it." or "one sec": `voicePromised`
 * (`./voiceOwed.ts`) reads those as a promise of work, which would arm the page's own promise press beside a turn
 * already running. Its final is also what hands the owner's closed words to that turn: `spokenRecordQueue.ts`
 * hands a running turn the record late only on a VOICE final, so the residue is a voice that says nothing here, or a
 * turn that completes first, which leaves those words queued for the next turn.
 */
export const RESUME_OVER_TURN_TEXT =
  "The owner has stopped talking and nothing has answered what they just said. The thinking model is still working " +
  "and now has these words too. Say only 'Mm-hm.' and nothing else: no answer, no card, no item, no next step and no " +
  "promise of work, since what the thinking model hands back is the answer. " +
  NEVER_HAND_BACK +
  "Never hand anything to the thinking model yourself: the console does.";

/**
 * Whether a resume goes over the turns running now: at least one runs, and the owner's latest words carrying text
 * arrived after every running turn started, so none heard them, and after the last resume, so one silence is
 * acknowledged once. A blank fragment is no words; a turn that already completed is
 * not running, so its later start never holds it. A running turn whose start was never stamped holds it.
 *
 * @param floor the call's snapshot, read for how many turns run
 * @param heardMs when the session last transcribed words of the owner's carrying text
 * @param runningStartsMs when each running Codex turn started, `undefined` for one never stamped
 * @param resumedMs when the last resume was taken, if any
 * @returns true when every running turn and the last resume came before the owner's latest words
 */
export function resumesOverRunningTurn({
  floor,
  heardMs,
  resumedMs,
  runningStartsMs,
}: {
  floor: PlanFloor;
  heardMs: number | undefined;
  resumedMs: number | undefined;
  runningStartsMs: readonly (number | undefined)[];
}): boolean {
  if (floor.runningTurns === 0 || runningStartsMs.length === 0 || heardMs === undefined) {
    return false;
  }
  const allBefore = runningStartsMs.every((startMs) => startMs !== undefined && startMs < heardMs);
  return allBefore && (resumedMs === undefined || heardMs > resumedMs);
}

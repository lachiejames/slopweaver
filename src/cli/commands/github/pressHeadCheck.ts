/**
 * The head check `slopweaver github landing --press` makes immediately before ONE row's press: does GitHub still
 * report the head this read judged.
 *
 * Its own module beside `./pressLedgerCheck.ts` and `./pressJudgment.ts`, the other two questions a row is asked
 * before its press; `./landingPress.ts` owns the order they are asked in.
 *
 * **What it is FOR, stated exactly, because an earlier draft of this comment got it wrong.** The commit-level
 * race is already closed at the far end: `github enqueue` reads the head itself and hands it to the
 * `enqueuePullRequest` mutation as `expectedHeadOid` (`src/corpus/github/writeQueue.ts`), so GitHub refuses
 * the write outright when the head moved. Reproduce with
 * `grep -n expectedHeadOid src/cli/commands/github/enqueueRun.ts`. What this read adds is a refusal NAMING
 * the moved head, and a run that never presses a commit whose six tests were computed against a different
 * one — not safety that would otherwise be missing.
 */

import type { MergeableRecheck } from "../../../live/github/mergeableRecheck.js";
import type { LandingRow } from "../../../review/landing.js";

/** How much of a head commit a refusal quotes — enough to identify it, short enough to read in a line. */
export const HEAD_CHARS = 7;

/**
 * Why one row must NOT be pressed because of its head, or undefined when it is safe to press.
 *
 * A row whose head could not be re-read is refused too: a press is a write, and a write over a head this run
 * could not confirm is the one thing the whole verb exists to avoid. Checked once per row, immediately before ITS
 * press, rather than once for the set: an earlier press takes time, and a later row's head can move inside that
 * window. A Codex review named exactly that sequence against the batched version.
 *
 * @param row the row about to be pressed
 * @param recheck GitHub's current head read, already bound to the state home whose credential it uses
 * @returns the sentence the refused press prints, or undefined
 */
export async function headRefusalAtPressTime({
  row,
  recheck,
}: {
  row: LandingRow;
  recheck: MergeableRecheck;
}): Promise<string | undefined> {
  const [answer] = await recheck({
    subjects: [{ headOid: row.headOid, number: row.number, repoSlug: row.repoSlug }],
  });
  if (answer?.kind !== "read") {
    return "not pressed: its head could not be re-read, and a press over an unconfirmed head is not made";
  }
  // A hex object id names one commit however it is cased, as `pressActionId` reads it too.
  if (answer.value.headOid.toLowerCase() !== row.headOid.toLowerCase()) {
    return (
      `not pressed: its head moved from ${row.headOid.slice(0, HEAD_CHARS)} to ${answer.value.headOid.slice(0, HEAD_CHARS)} ` +
      "since this read judged it — run the read again"
    );
  }
  return undefined;
}

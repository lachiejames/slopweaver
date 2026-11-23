/**
 * Which of a hand step card's rows sit behind its disclosure — the machinery the owner does not read to act.
 *
 * The unblocks line, the where field, the done-when command and the posted-by line each cost the owner a parse and
 * tell them nothing to act on. So above the fold sits the call to action and what doing nothing costs them; the settling command, the cites, the unblocks line a
 * do-nothing line replaced, and a `where` the chip already answers go behind it. `posted by` is not drawn at all.
 * Its own module because `./handCard.ts` sits near the file-length cap.
 */

/** The fields of a step record the fold reads. */
interface FoldedStep {
  readonly literal: string | undefined;
  readonly checklist: readonly unknown[] | undefined;
}

/**
 * Whether the step's `where` goes behind the fold: when a `go to` chip draws, the chip is the place — unless the step
 * has the owner paste something, where `where` says where the paste goes (`src/hand/posting.ts`'s address rule).
 *
 * @param step the record's paste and script
 * @param destination the place the card's chip sends the owner, when it draws one
 * @returns true when `where` belongs behind the fold
 */
export function whereBehind({ step, destination }: { step: FoldedStep; destination: string | undefined }): boolean {
  return destination !== undefined && step.literal === undefined && step.checklist === undefined;
}

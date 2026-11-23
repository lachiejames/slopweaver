/**
 * Which of the board sweep's OWN daily cards a `--queue` pass takes off the owner's Queue, and on what witness. Pure:
 * the pass's candidates, its plan and its instant in, the cards to settle out.
 *
 * ## Why the sweep retires its own cards
 *
 * MEASURED: two earlier days' `sweep-board-YYYY-MM-DD` cards both sat on the owner's Queue a day after
 * `slopweaver sweep board` read SHIPPED 0 UNCARDED 0 — each card is a reading of one morning's board, and nothing
 * took a reading down once a later pass contradicted it. A card is only ever this sweep's reading, so the sweep that
 * reads the board again is the one placed to say it no longer holds:
 *
 * - **Nothing left** (no plan): every live daily card settles, today's included, because nothing it asked about is on
 *   the board any more.
 * - **Something left** (a plan): every live daily card from an EARLIER day settles, because today's card is the
 *   current reading — two cards about one board is the second copy the Queue exists to avoid. The caller retires
 *   nothing unless today's card registered or was already on the board, so the owner is never left with neither.
 *
 * `answered`, never `declined`: a decline is the owner's alone. The settle is re-judged at the write
 * (`closureSettlePrecondition`), so a card a seat picked up, or one the owner paused, is left.
 */
import type { SweepCandidate } from "./classify.js";
import { isSweepQueueSlug, type SweepQueuePlan, sweepQueueSlug } from "./dailyQueue.js";

/** One own card to settle, and the witness it settles on. */
export interface CardRetirement {
  readonly candidate: SweepCandidate;
  readonly witness: string;
}

/**
 * The own daily cards this pass settles.
 *
 * @param candidates every row the pass classified, after its acts; a live card is one not judged over closed rows
 * @param plan today's card, or undefined when the pass found nothing for the owner
 * @param nowIso the pass's instant, which every witness names
 * @returns the cards to settle, in board order
 */
export function retiredSweepCards({
  candidates,
  plan,
  nowIso,
}: {
  candidates: readonly SweepCandidate[];
  plan: SweepQueuePlan | undefined;
  nowIso: string;
}): readonly CardRetirement[] {
  const today = sweepQueueSlug({ nowIso });
  // UNCARDED is the one verdict judged over CLOSED rows, so every other candidate is a live row. A card dated after
  // this pass is no reading this pass can contradict, so it is never retired; the slugs order by date, oldest first,
  // so a cap leaves the newest standing.
  const live = candidates
    .filter(
      (candidate) =>
        candidate.verdict !== "UNCARDED" && isSweepQueueSlug({ slug: candidate.slug }) && candidate.slug <= today,
    )
    .toSorted((left, right) => left.slug.localeCompare(right.slug));
  if (plan === undefined) {
    const shipped = candidates.filter((candidate) => candidate.verdict === "SHIPPED").length;
    const witness =
      `sweep board at ${nowIso} reads UNCARDED 0 and SHIPPED ${String(shipped)} — no page is left for the owner to ` +
      "card, and a shipped row is closed by --close-shipped rather than carded";
    return live.map((candidate) => ({ candidate, witness }));
  }
  // Never "carries every page": a card registered earlier today may name a different set than this pass reads.
  const witness = `${plan.slug} is the live board-sweep card as of ${nowIso}, so this earlier day's card is no longer the reading`;
  return live.filter((candidate) => candidate.slug !== plan.slug).map((candidate) => ({ candidate, witness }));
}

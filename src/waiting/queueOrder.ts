/**
 * The ONE order the owner's Queue page, the voice and the board's reconcile lead with — the owner's stated priorities first.
 *
 * The order things are raised in must exactly match the order the queue puts things to the owner in, which must
 * exactly match whatever alignment maximising suggests. Measured once: the page led with a held automation, the
 * voice opened a different card, and neither was the ruled order: the owner's ranked priorities' cards in rank
 * order, those ranked by controls resolved, a blocker on those priorities first with its reason, everything else
 * parked below.
 *
 * ## Four bands, and the order is the rule
 *
 * 1. **blocker** — a card blocking one of the owner's ranked priorities, by the priority it blocks.
 * 2. **priority** — a card advancing one of them: by the priority's rank, then the board band it sits in (`p0`
 *    first), then the failing controls it resolves, most first. A card stating no count follows one that does.
 * 3. **stopped** — an automation or a sync that stopped, or one stopped on the owner's own hold. For a
 *    held error-tracking top-up ("disabled for now", the owner says when it resumes), a hold of the owner's is not a blocker on
 *    their priorities, so it ranks below them.
 * 4. **rest** — everything else.
 *
 * Within a band, and on every key a fact leaves unstated, the caller's order stands: this decides only what moves
 * ahead, so an order nobody asked for cannot sneak in through a sort.
 *
 * ## Who reads it
 *
 * `src/handover/rank.ts` `rankRows` (the board's reconcile) reads this file. The console's Queue, its triage pass and the
 * voice's `action_items` read `site/lib/queueOrderRank.ts`, a mirror of it — `site/` cannot import `src/` (TS6059) —
 * held to the same answers by `site/__tests__/unit/waitingRank.test.ts`, which imports both.
 *
 * Pure and import-free: facts in, an order out. No clock.
 */

/** Which of the four bands a thing ranks in. */
export type QueueBand = "blocker" | "priority" | "stopped" | "rest";

/** The bands, first-led first. */
export const QUEUE_BANDS: readonly QueueBand[] = ["blocker", "priority", "stopped", "rest"];

/** What the order reads off one thing. */
export interface QueueFact {
  readonly band: QueueBand;
  /** Where the priority it blocks or advances stands, 0 first. Read in the blocker and priority bands only. */
  readonly priorityRank?: number;
  /** Its board band, `p0` as 0. Read in the priority band only. */
  readonly boardBand?: number;
  /** The failing controls its act resolves. Read in the priority band only, most first. */
  readonly controlsResolved?: number;
}

/**
 * Compare one optional key, smaller first, a stated value ahead of an unstated one.
 *
 * @returns negative when `left` leads, positive when `right` does, zero when neither does
 */
function smallerFirst({ left, right }: { left: number | undefined; right: number | undefined }): number {
  if (left === undefined || right === undefined) {
    return Number(left === undefined) - Number(right === undefined);
  }
  // Compared, never subtracted: two equal infinities subtract to NaN, which would end the comparison as a tie.
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Compare two facts' keys: band, then — inside the blocker and priority bands — the priority's rank, then inside the
 * priority band its board band and the controls it resolves, most first.
 *
 * @returns negative when `left` leads, positive when `right` does, zero when the caller's order stands
 */
function compareFacts({ left, right }: { left: QueueFact; right: QueueFact }): number {
  const band = QUEUE_BANDS.indexOf(left.band) - QUEUE_BANDS.indexOf(right.band);
  if (band !== 0 || left.band === "stopped" || left.band === "rest") {
    return band;
  }
  const rank = smallerFirst({ left: left.priorityRank, right: right.priorityRank });
  if (rank !== 0 || left.band === "blocker") {
    return rank;
  }
  const board = smallerFirst({ left: left.boardBand, right: right.boardBand });
  if (board !== 0) {
    return board;
  }
  // Negated, so the most controls resolved leads while an unstated count still follows a stated one.
  return smallerFirst({
    left: left.controlsResolved === undefined ? undefined : -left.controlsResolved,
    right: right.controlsResolved === undefined ? undefined : -right.controlsResolved,
  });
}

/**
 * Order things by {@link QUEUE_BANDS} and the keys each band reads, keeping the caller's order wherever no key
 * separates two of them.
 *
 * @param items the things, in the caller's own order
 * @param factOf reads one thing's fact, once each, in item order
 * @returns the things in the one order; the same list when nothing moves, so a caller memoising on it sees no change
 */
export function rankQueue<T>({ items, factOf }: { items: readonly T[]; factOf: (item: T) => QueueFact }): readonly T[] {
  // Each fact is read once, in item order, before the sort, as the site's mirror reads them: a comparator calling the
  // reader would ask in whatever order the sort compares, so a reader that is not pure could rank the mirrors apart.
  const ranked = items
    .map((item, index) => ({ fact: factOf(item), index, item }))
    .toSorted((left, right) => compareFacts({ left: left.fact, right: right.fact }) || left.index - right.index)
    .map((entry) => entry.item);
  if (ranked.every((item, index) => item === items[index])) {
    return items;
  }
  return ranked;
}

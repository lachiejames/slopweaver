/**
 * The console's copy of the ONE order the owner's Queue page, the voice and the board's reconcile lead with —
 * `src/waiting/queueOrder.ts` states the rule, the owner's words behind it, and every surface that reads it.
 *
 * A mirror because `site/` cannot import `src/`. `site/__tests__/unit/waitingRank.test.ts` imports both and runs one
 * case table through each, so an order that drifts on one side only is a failed test rather than the page leading the owner
 * to one card while reconcile ranks another. Written differently on purpose (a key tuple compared left to right rather
 * than a chain of comparisons) so the clone ratchet never has to argue for it; the drift test keeps the ANSWERS
 * identical.
 *
 * Imports nothing, so the unit lane and the drift test load it on its own.
 */

/** Which of the four bands a thing ranks in. */
export type QueueBand = "blocker" | "priority" | "stopped" | "rest";

/** The bands, first-led first. */
export const QUEUE_BANDS: readonly QueueBand[] = ["blocker", "priority", "stopped", "rest"];

/** Each band's place in the order: smaller leads. */
const BAND_PLACE: Readonly<Record<QueueBand, number>> = { blocker: 0, priority: 1, rest: 3, stopped: 2 };

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
 * One optional value as two keys: whether it is unstated, then the value itself. A sentinel standing in for "unstated"
 * would tie with a stated value equal to it (`Number.MAX_SAFE_INTEGER`), so absence is its own key.
 *
 * @param value the stated value, smaller first
 * @returns `[0, value]` when stated, `[1, 0]` when not
 */
function unstatedLast({ value }: { value: number | undefined }): readonly number[] {
  if (value === undefined) {
    return [1, 0];
  }
  return [0, value];
}

/**
 * One fact as the tuple the order compares, left to right: a key a band does not read is the same for every thing in
 * it, so it never separates two of them.
 *
 * @returns the sort keys, smaller first
 */
function keysOf({ fact }: { fact: QueueFact }): readonly number[] {
  const reads = fact.band === "blocker" || fact.band === "priority";
  const readsAll = fact.band === "priority";
  let rank: readonly number[] = [0, 0];
  if (reads) {
    rank = unstatedLast({ value: fact.priorityRank });
  }
  let board: readonly number[] = [0, 0];
  let controls: readonly number[] = [0, 0];
  if (readsAll) {
    board = unstatedLast({ value: fact.boardBand });
    let most: number | undefined;
    if (fact.controlsResolved !== undefined) {
      most = -fact.controlsResolved;
    }
    controls = unstatedLast({ value: most });
  }
  return [BAND_PLACE[fact.band], ...rank, ...board, ...controls];
}

/**
 * Order things by {@link QUEUE_BANDS} and the keys each band reads, keeping the caller's order wherever no key
 * separates two of them.
 *
 * @param items the things, in the caller's own order
 * @param factOf reads one thing's fact, once each, in item order
 * @returns the things in the one order; the same list when nothing moves
 */
export function rankQueue<T>({ items, factOf }: { items: readonly T[]; factOf: (item: T) => QueueFact }): readonly T[] {
  const keyed = items.map((item, index) => ({ index, item, keys: keysOf({ fact: factOf(item) }) }));
  const ranked = keyed.toSorted((left, right) => {
    const differs = left.keys.findIndex((key, at) => key !== right.keys[at]);
    if (differs === -1) {
      return left.index - right.index;
    }
    // Compared, never subtracted, as the src rule compares.
    return left.keys[differs] < right.keys[differs] ? -1 : 1;
  });
  const moved = ranked.some((entry, index) => entry.index !== index);
  if (!moved) {
    return items;
  }
  return ranked.map((entry) => entry.item);
}

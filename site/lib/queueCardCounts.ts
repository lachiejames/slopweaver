/**
 * The queue's two counts and a card's number in the drawn list — split out of `./queueCard.ts`. Imports nothing.
 */

/** How many rows are waiting on the owner's word, and how many are check-ins merely to review. */
export interface QueueCounts {
  readonly waiting: number;
  readonly toReview: number;
}

/**
 * Split the rows into the two numbers the sidebar badge and the page header both print.
 *
 * ONE function so the two surfaces cannot disagree — which is the defect to avoid: two surfaces disagreeing, not a wrong count.
 *
 * The line is the ranking's (`./waitingRank.ts`), not a register list. An act in the autonomy ledger ALREADY
 * HAPPENED, so it is counted apart rather than folded into one number that means two things (a queue chip
 * reading 0 beside a header reading 301 pending and an unsteered chip reading 613). The same line holds for every
 * CHECK-IN, not just the acts: a hand step its poster marked `--check-in` asks
 * whether something already done is right, and counting it beside a pull request a colleague waits on would lead
 * the owner to the "I did this, is that cool with you" row first. The tier is read structurally, as a string,
 * so this module still imports nothing.
 *
 * @param rows every row the page holds, after the work-context filter
 * @returns the two counts
 */
export function queueCounts({ rows }: { rows: readonly { readonly tier: string }[] }): QueueCounts {
  const toReview = rows.filter((row) => row.tier === "check-in").length;
  return { toReview, waiting: rows.length - toReview };
}

/**
 * The number a card carries beside its question: the row's place in the list the owner is LOOKING AT.
 *
 * It is the DRAWN list, not the filtered one — each register shows its first rows and then a row saying
 * how many more it holds, so numbering the filtered list printed 1–8 and then jumped to 36. A row the
 * drawn list does not hold has no number at all, and this answers `undefined` rather than a figure:
 * `drawnKeys.indexOf(key) + 1` is what stood here, and it is 0 on a miss — a panel left open until its
 * register dropped the row was headed "0" beside rows still numbered from 1.
 *
 * @param drawnKeys the keys of the rows the page is drawing, in the order it draws them
 * @param key the row's own `<kind>:<id>`
 * @returns the 1-based place, or nothing when the drawn list does not hold the row
 */
export function cardNumber({ drawnKeys, key }: { drawnKeys: readonly string[]; key: string }): number | undefined {
  const at = drawnKeys.indexOf(key);
  return at < 0 ? undefined : at + 1;
}

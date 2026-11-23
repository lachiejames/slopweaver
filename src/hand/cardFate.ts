/**
 * What became of one hand card, read off the register's rows — pure.
 *
 * `handover settle` asks this when the row it ends was registered by a talk relay about `hand:<id>`: an OPEN card
 * needs its fate said (done or kept), a card a re-cut SUPERSEDED needs the re-cut named, and a card closed any
 * other way is nothing settle has to answer for. Whoever settles an answer also says what happens to the card: done,
 * re-cut, or kept with the reason.
 *
 * A re-cut is read off its CAUSAL edge — a posting whose carried `settles.id` is this card — never off the free
 * text of a `did`, and never off mere absence from the open list, which a done, a retract and an evidence
 * settling all produce too.
 */
import { type HandRow, isSettledRow, openHandSteps } from "./row.js";

/** One hand card's fate in the register. */
export type HandCardFate =
  /** Still waiting on the owner. */
  | { readonly kind: "open" }
  /** Replaced by a re-cut: each posting whose own line settled this card. */
  | { readonly kind: "superseded"; readonly successors: readonly string[] }
  /** Settled another way — the account each settling recorded, in file order. */
  | { readonly kind: "settled"; readonly dids: readonly string[] }
  /** Never posted in this register. */
  | { readonly kind: "absent" };

/**
 * The fate of the card `id` in a register's rows.
 *
 * @param rows every row the register holds, in file order, a re-cut's carried settling included
 * @param id the card's step id
 * @returns open, superseded (naming its successors), settled (with each account) or absent
 */
export function handCardFate({ rows, id }: { rows: readonly HandRow[]; id: string }): HandCardFate {
  if (openHandSteps({ rows }).some((step) => step.id === id)) {
    return { kind: "open" };
  }
  const successors = rows.flatMap((row) => (!isSettledRow(row) && row.settles?.id === id ? [row.step.id] : []));
  if (successors.length > 0) {
    return { kind: "superseded", successors };
  }
  const dids = rows.flatMap((row) => (isSettledRow(row) && row.id === id ? [row.did] : []));
  if (dids.length > 0) {
    return { dids, kind: "settled" };
  }
  return { kind: "absent" };
}

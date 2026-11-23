/**
 * Whether a correction moves a claim's figures by an order of magnitude — the half of the rule on sending a
 * correction without the owner that code can compute. Split out of `./claimCorrection.ts` under the file-size cap and
 * exported from here only, with neither module importing the other: that one composes the edit, this one only compares
 * the numbers on either side of it. Pure.
 */

/** A figure, thousands separators allowed: `30`, `1,200`, `0.4`, `-3`. */
const FIGURE = /-?\d[\d,]*(?:\.\d+)?/gu;

/** A version, three dotted parts or more: `4.2.0` names a release, never a quantity. */
const VERSION = /\bv?\d+(?:\.\d+){2,}\b/gu;

/** Every figure in a text, in order, as numbers — a version masked out first so its parts are not read as counts. */
function figuresOf({ text }: { text: string }): readonly number[] {
  return [...text.replaceAll(VERSION, " ").matchAll(FIGURE)]
    .map((match) => Number(match[0].replaceAll(",", "")))
    .filter((value) => Number.isFinite(value));
}

/** Whether two figures sit an order of magnitude or more apart; a zero against anything else counts. */
function ordersApart({ from, to }: { from: number; to: number }): boolean {
  const low = Math.min(Math.abs(from), Math.abs(to));
  const high = Math.max(Math.abs(from), Math.abs(to));
  if (low === 0) {
    return high !== 0;
  }
  return high / low >= 10;
}

/**
 * What the magnitude line holds: a figure moved by an order of magnitude or more, or two figure lists of different
 * lengths, where one inserted or dropped figure moves every position after it and no pairing can say which moved.
 */
export type MagnitudeShift =
  | { readonly kind: "shift"; readonly from: number; readonly to: number }
  | {
      readonly kind: "unpaired";
      readonly claimFigures: readonly number[];
      readonly correctionFigures: readonly number[];
    };

/**
 * Whether a correction moves the claim's figure by an ORDER OF MAGNITUDE — the line the rule draws: a session may
 * correct the numbers and send alone when ten and thirty are the same order of magnitude, but an order of magnitude
 * difference materially changes the impact and severity of an incident, so the owner is asked before it is sent.
 *
 * The one half of that line code can compute: EVERY figure the wrong claim states against the figure in the same
 * position in the correction, any pair a factor of ten or more apart (a zero against anything else counts — nothing to
 * something is not a refinement). Every position, not the first: "in 1 incident, 10 users" corrected to "in 1
 * incident, 1000 users" moves the second figure a hundredfold behind an unchanged first. A version is masked before
 * reading, so `4.2.0` to `4.2.1` is a different release rather than zero becoming one. Two sides stating no figure at all are
 * outside it; whether a worded correction matters is the session's judgement, as the rest of the rule says. A
 * figure worded away, or one appearing where the claim had words, is a differing count. Positions only pair when the two sides state the SAME NUMBER of figures: one inserted or dropped figure moves
 * every position after it, and no matching of bare numbers can say which one moved (two reviews found two different
 * matchings defeated), so a differing count is held as `unpaired` — the session restates both with the same figures,
 * or asks the owner.
 *
 * @param wrong the claim's exact words
 * @param correction what is true now
 * @returns the first pair an order of magnitude apart, `unpaired` when the counts differ, else undefined
 */
export function magnitudeShift({
  wrong,
  correction,
}: {
  wrong: string;
  correction: string;
}): MagnitudeShift | undefined {
  const before = figuresOf({ text: wrong });
  const after = figuresOf({ text: correction });
  if (before.length !== after.length) {
    return { claimFigures: before, correctionFigures: after, kind: "unpaired" };
  }
  for (const [index, from] of before.entries()) {
    const to = after[index]!;
    if (ordersApart({ from, to })) {
      return { from, kind: "shift", to };
    }
  }
  return undefined;
}

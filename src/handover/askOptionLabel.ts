/**
 * The letter label an ask option's author typed into its own sentence — the one grammar both option writers refuse
 * (`./askShape.ts`'s `parseAskOptions`, `./askActionDestination.ts`'s destination labels).
 *
 * The card letters options by POSITION and draws that badge beside the sentence, so an authored label makes two, and a
 * lean naming the typed letter points at the wrong option: a row whose options were typed C, B, A at positions A,
 * B, C, with its lean "C", drew a lean at the third option that meant the first.
 */

/**
 * `C · …`, `C. …`, `C) …`, `C: …`, `C - …`, `C – …`, `C — …` or `(C) …`, for the four letters an ask can carry. The
 * trailing space-or-end keeps `A:B testing` and `A.mazon` out; `A separate app` has no separator, so it never matches.
 */
const AUTHORED_LABEL = /^\(?([A-D])(?:\)|[.:]|[ \t]+[·\-–—])(?=[ \t]|$)/u;

/**
 * The letter an option sentence opens with as its own label, if any.
 *
 * @param text an option sentence or a destination label, as its author typed it
 * @returns the typed letter, or `undefined` when the text carries no label of its own
 */
export function authoredOptionLetter({ text }: { text: string }): string | undefined {
  const match = AUTHORED_LABEL.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  return match[1];
}

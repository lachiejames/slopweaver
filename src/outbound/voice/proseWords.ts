/**
 * What one prose word is, counted ONE way for both halves of the voice length model.
 *
 * The send door counts the authored prose of a body it is about to send (`./lengthRegister.ts`), and
 * `profile voice measure` counts the words of each Slack message the owner sent (`../../profile/voiceMeasure.ts`). Two
 * counters would let a register be measured in one unit and judged in another, so both call this.
 */

/** One prose word: a whitespace-separated token carrying a letter or a digit. An emoji alone is not one. */
const PROSE_WORD = /[\p{L}\p{N}]/u;

/**
 * How many prose words a text carries: whitespace-separated tokens holding at least one letter or digit.
 *
 * @returns the word count, zero for text that is empty, whitespace or punctuation and emoji only
 */
export function proseWordCount({ text }: { text: string }): number {
  return text.split(/\s+/u).filter((word) => PROSE_WORD.test(word)).length;
}

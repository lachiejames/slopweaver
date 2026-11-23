/**
 * Whether a register field carries words at all — a leaf both the parked-line and the comparison-line readers import,
 * so neither has to import the other for it.
 */

/**
 * Whether a judgement's text carries a letter, digit, punctuation or symbol once every default-ignorable code point is
 * set aside. `trim` misses separators such as U+0085, and U+200B, U+034F and the U+3164 filler render as nothing, so a
 * field of only those reads blank here rather than as words the owner said. A lone combining mark
 * has nothing to sit on, so it is not a word either.
 *
 * @param text the anchor, heard words, why or declared change
 * @returns true when at least one visible character is present
 */
export function carriesWords({ text }: { text: string }): boolean {
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(text.replaceAll(/\p{Default_Ignorable_Code_Point}/gu, ""));
}

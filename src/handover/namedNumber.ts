/**
 * How prose names a pull request by number — one leaf, so a reader that only needs the pattern
 * (`../supervisor/intakeWitness.ts`) does not load `./cardAlignment.ts`'s hatch register to get it.
 */

/**
 * A pull request named by number: a hash then digits, `PR` then digits (with or without the hash), or `pull request` then digits.
 *
 * `#` is not taken after a word character, `/` or `&` — a URL fragment, a path and an HTML entity (`&#39;`)
 * are not references. Two digits at least, and a space after `PR`, because `PR3` and `option #1` are
 * positions in a list rather than pull requests. Any whitespace inside `pull request`, because a line break
 * there reaches the card as one space, and `register` flattens it before judging while `ask` does not.
 */
export const NAMED_NUMBER = /(?<![\w/&])#(\d{2,})\b|\b(?:PR|pull\s+request)\s+#?(\d{2,})\b/giu;

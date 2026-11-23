/**
 * Control-byte sanitisation — the structural half of "scrub what we pull from every source".
 *
 * {@link ./redact} already scrubs the PRIVACY half (tokens, emails, long digit runs). This module handles a
 * different failure: bytes that are not content at all, and that break the things downstream of them.
 *
 * ## Why it is not cosmetic, measured
 *
 * Over the whole real corpus (374,369 rows),**915 records carry a C0 control byte** — 910 of
 * them GitHub, and the commonest is `U+001B`, the ANSI escape introducer, arriving inside issue comments
 * where somebody pasted terminal output. Five more carry `U+FFFD`, the replacement character left by a
 * decode that already went wrong.
 *
 * Three concrete costs, none hypothetical:
 *
 *  - **Bronze is JSONL and its one invariant is a record per line.** A raw control byte inside a record is a
 *    line terminator to some readers, so a record carrying one can split into two unparseable halves.
 *  - **An ANSI escape is executable when a human reads it.** These strings reach a terminal through
 *    `slopweaver store cite`, `store read` and every progress line; an escape can move the cursor and
 *    overwrite what was
 *    already printed, so text from an untrusted comment can rewrite the output above it. Stripping is the
 *    cheap, total fix.
 *  - **A stray NUL used to cost a whole FILE.** `self`'s scan treated any NUL as proof of a binary and
 *    refused the file entire — 239 lines of real prose lost to one byte. Density, not presence, is the
 *    honest test, and it lives here so both callers share one definition.
 *
 * ## What is deliberately kept
 *
 * TAB, LF and CR are content: they carry the shape of a document. Everything else below `U+0020`, plus DEL,
 * is removed. Nothing above `U+007F` is touched — emoji, accents and CJK are content, and a sanitiser that
 * decided otherwise would quietly damage most of a real corpus.
 *
 * Pure module — no I/O, no clock.
 */

/**
 * Whether one code point is a byte to remove: a C0 control that is not TAB, LF or CR, or DEL.
 *
 * Written as a numeric predicate rather than a regular-expression character class on purpose — a class
 * spelling this range has to CONTAIN the very bytes it matches, and a source file holding a raw control
 * byte is what the repo's `control-bytes` gate exists to refuse. Hex literals carry the same meaning in
 * plain ASCII.
 *
 * @param code the UTF-16 code unit to test
 * @returns true when the character should be stripped
 */
function isStrippableControl({ code }: { code: number }): boolean {
  const isC0 = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
  return isC0 || code === 0x7f;
}

/** The replacement character, left behind by a decode that already failed. Counted, never "repaired". */
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/**
 * The share of a text that must be control bytes before it is called binary rather than prose.
 *
 * One percent, and paired with {@link BINARY_MIN_CONTROL} below because a ratio alone is wrong at both ends:
 * a 20-character note with a single stray NUL is 5% control and is obviously prose, while a PNG read as
 * UTF-8 is both far over the ratio and far over the count. Requiring BOTH is what lets a real file survive
 * one bad byte while a real binary is still refused.
 */
const BINARY_CONTROL_RATIO = 0.01;

/** The floor on control-byte COUNT before the ratio is consulted at all. See {@link BINARY_CONTROL_RATIO}. */
export const BINARY_MIN_CONTROL = 8;

/** What a sanitisation pass removed, so a caller can report it rather than silently improving the data. */
export interface Sanitisation {
  /** The text with control bytes removed. */
  readonly text: string;
  /** How many characters were removed. Zero means the input was already clean. */
  readonly removed: number;
}

/**
 * Remove control bytes from a text, reporting how many went. Pure.
 *
 * @param text the text to sanitise
 * @returns the cleaned text and the number of characters removed
 */
export function stripControlBytes({ text }: { text: string }): Sanitisation {
  let cleaned = "";
  for (const char of text) {
    if (!isStrippableControl({ code: char.charCodeAt(0) })) {
      cleaned += char;
    }
  }
  return { removed: text.length - cleaned.length, text: cleaned };
}

/**
 * How many control bytes a text holds, without building a cleaned copy. Pure.
 *
 * @param text the text to inspect
 * @returns the count of removable control characters
 */
export function countControlBytes({ text }: { text: string }): number {
  let count = 0;
  for (const char of text) {
    if (isStrippableControl({ code: char.charCodeAt(0) })) {
      count += 1;
    }
  }
  return count;
}

/**
 * How many replacement characters a text holds — evidence of a decode that already failed upstream. Pure.
 *
 * Reported rather than stripped: unlike a control byte, `U+FFFD` occupies the position of content that was
 * genuinely lost, so removing it would hide the loss instead of recording it.
 *
 * @param text the text to inspect
 * @returns the count of `U+FFFD` characters
 */
export function countReplacementChars({ text }: { text: string }): number {
  return text.split(REPLACEMENT_CHAR).length - 1;
}

/**
 * Whether a text is really a binary read as UTF-8, rather than prose carrying a few bad bytes. Pure.
 *
 * Both a COUNT floor and a RATIO must be exceeded — see {@link BINARY_CONTROL_RATIO} for why either alone
 * gives the wrong answer on a real corpus.
 *
 * @param text the decoded text
 * @returns true when the content should be refused rather than sanitised
 */
export function looksBinary({ text }: { text: string }): boolean {
  if (text.length === 0) {
    return false;
  }
  const control = countControlBytes({ text }) + countReplacementChars({ text });
  return control >= BINARY_MIN_CONTROL && control / text.length > BINARY_CONTROL_RATIO;
}

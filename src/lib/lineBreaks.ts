/**
 * What counts as a line break in text a reader splits into lines, and the three things done about one: a one-line
 * field REFUSES it, a printed line FOLDS it, and a serialised JSON document ESCAPES it.
 *
 * Why it matters: `supervisor tick open` lifts `claude gauge` output by each line's opening words (`PLAN `,
 * `CHAIR`, `REACT NOW`), so a line break inside configured or reported text — a pause reason, a probe's problem,
 * a cached account address — would print a forged line a reader trusts as the gauge's own. Review found it in that
 * order: a line feed in a pause reason, then in an address, then a
 * U+2028, then a U+2028 that `JSON.stringify` printed raw. CR and LF alone are not the class, because a terminal
 * and a JavaScript line split honour more.
 *
 * The NEL and Unicode separator characters are built from code points, never written as escapes in this source:
 * a raw U+2028 in a diff broke Codex's JSON-lines review transport twice, and an escape is one tool rewrite away
 * from becoming the raw character.
 */

/** NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR: the line breaks above U+0020, which `JSON.stringify` leaves raw. */
const HIGH_LINE_BREAKS = [0x85, 0x2028, 0x2029].map((point) => String.fromCodePoint(point)).join("");

/** Every character a reader or a terminal may treat as ending a line: CR, LF, VT, FF, then the three above. */
const LINE_BREAK_CLASS = `\\r\\n\\v\\f${HIGH_LINE_BREAKS}`;

/** Any one line-break character. No `g` flag, so `.test` carries no state between calls. */
const ANY_LINE_BREAK = new RegExp(`[${LINE_BREAK_CLASS}]`, "u");

/** A run of line breaks with the whitespace around it, which {@link foldLineBreaks} replaces with one space. */
const LINE_BREAK_RUN = new RegExp(`[^\\S${LINE_BREAK_CLASS}]*[${LINE_BREAK_CLASS}]+\\s*`, "gu");

/** A line break `JSON.stringify` leaves raw, which {@link escapeJsonLineBreaks} writes as an escape. */
const JSON_RAW_LINE_BREAK = new RegExp(`[${HIGH_LINE_BREAKS}]`, "gu");

/**
 * Whether a text carries a line break of any kind — what a one-line field refuses at parse.
 *
 * @param text the text as configured or reported
 * @returns true when any character in it may end a line
 */
export function hasLineBreak({ text }: { text: string }): boolean {
  return ANY_LINE_BREAK.test(text);
}

/**
 * One printed line folded so it stays ONE physical line. Only line breaks fold, so a table's alignment padding
 * survives byte for byte.
 *
 * @param text the line as rendered
 * @returns the same line with every line break, and the whitespace around it, as one space
 */
export function foldLineBreaks({ text }: { text: string }): string {
  return text.replace(LINE_BREAK_RUN, " ");
}

/**
 * A serialised JSON document with the line breaks `JSON.stringify` leaves raw written as `\uXXXX` escapes, so the
 * document stays one physical line for any reader that splits stdout into lines. The value it parses back to is
 * unchanged, because an escape inside a JSON string decodes to the same character.
 *
 * @param json the output of `JSON.stringify`
 * @returns the same document, every NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR escaped
 */
export function escapeJsonLineBreaks({ json }: { json: string }): string {
  return json.replace(
    JSON_RAW_LINE_BREAK,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

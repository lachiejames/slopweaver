/**
 * Keep one printed entry on one physical line. A browser read counts its budget in ENTRIES, so a page name or a
 * typed `--find` holding a line break would print as two lines while counting as one (with LF,
 * or with U+2028, which `JSON.stringify` leaves raw).
 */

/**
 * Every code point a terminal, an editor or a JavaScript reader may break a line on: LF, VT, FF, CR, NEL, and the
 * Unicode line and paragraph separators. Held as numbers so the source itself never carries a raw separator.
 */
const LINE_BREAK_CODES: ReadonlySet<number> = new Set([0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029]);

/**
 * Escape every line break in `text` as its `\uXXXX` spelling, so the text prints on exactly one line and still
 * shows that a break was there.
 *
 * @param text one entry, whatever the page or the caller put in it
 * @returns the same text with no line break left in it
 */
export function oneLine({ text }: { text: string }): string {
  let escaped = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    escaped += LINE_BREAK_CODES.has(code) ? `\\u${code.toString(16).padStart(4, "0")}` : character;
  }
  return escaped;
}

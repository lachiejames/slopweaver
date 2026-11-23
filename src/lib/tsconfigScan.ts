/**
 * The lexical layer of `./tsconfigText.ts`: the cursor, the character classes TypeScript's scanner uses, trivia, and
 * numeric literals spelled as JavaScript spells them (`0x10`, `.5`, `1_000`, `1e-3`). Every non-ASCII character is
 * built from its code point, so this source stays ASCII.
 */

/** The two line terminators beyond CR and LF. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/**
 * Whether a character ends a line, as JavaScript counts line terminators.
 *
 * @param char one UTF-16 code unit, or `""` past the end of a text
 * @returns true for CR, LF, the line separator and the paragraph separator
 */
export function isLineBreak({ char }: { char: string }): boolean {
  return char === "\n" || char === "\r" || char === LINE_SEPARATOR || char === PARAGRAPH_SEPARATOR;
}

/**
 * The single-line whitespace TypeScript's scanner skips, byte-order mark and zero-width space included: space, tab,
 * vertical tab, form feed, no-break space, next line, ogham space, en quad through zero-width space, narrow no-break
 * space, medium mathematical space, ideographic space and the byte-order mark.
 */
const SINGLE_LINE_WHITESPACE: ReadonlySet<string> = new Set(
  [
    0x20, 0x09, 0x0b, 0x0c, 0xa0, 0x85, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
    0x2009, 0x200a, 0x200b, 0x202f, 0x205f, 0x3000, 0xfeff,
  ].map((code) => String.fromCharCode(code)),
);

/** The read position over one text. */
export interface Cursor {
  readonly text: string;
  pos: number;
}

/**
 * Thrown inside the tsconfig reader only, and turned into its typed syntax error at `parseTsconfigText`, its one
 * exported entry.
 */
export class SyntaxFailure extends Error {
  readonly at: number;
  constructor({ reason, at }: { reason: string; at: number }) {
    super(reason);
    this.at = at;
  }
}

/**
 * Stop reading, naming why and where.
 *
 * @param reason what was wrong, in TypeScript's own diagnostic wording where it has one
 * @param at the offset of the offending character
 */
export function fail({ reason, at }: { reason: string; at: number }): never {
  throw new SyntaxFailure({ at, reason });
}

/** Move to the end of the current line, leaving the line break itself unread. */
export function skipLine({ cursor }: { cursor: Cursor }): void {
  const { text } = cursor;
  while (cursor.pos < text.length && !isLineBreak({ char: text.charAt(cursor.pos) })) {
    cursor.pos += 1;
  }
}

/** Skip one comment at the cursor, refusing an unterminated block comment; true when there was one. */
function skipComment({ cursor }: { cursor: Cursor }): boolean {
  const { text } = cursor;
  if (text.startsWith("//", cursor.pos)) {
    skipLine({ cursor });
    return true;
  }
  if (!text.startsWith("/*", cursor.pos)) {
    return false;
  }
  const close = text.indexOf("*/", cursor.pos + 2);
  if (close === -1) {
    fail({ at: text.length, reason: "'*/' expected." });
  }
  cursor.pos = close + 2;
  return true;
}

/** Skip whitespace and comments, refusing an unterminated block comment. */
export function skipTrivia({ cursor }: { cursor: Cursor }): void {
  for (;;) {
    const char = cursor.text.charAt(cursor.pos);
    if (SINGLE_LINE_WHITESPACE.has(char) || isLineBreak({ char })) {
      cursor.pos += 1;
    } else if (!skipComment({ cursor })) {
      return;
    }
  }
}

/**
 * Whether a character is a digit of a radix.
 *
 * @param char one character, or `""` past the end of a text
 * @returns true for `0`–`9` and `a`–`f` in either case, each only below the radix
 */
export function isDigitOf({ char, radix }: { char: string; radix: 2 | 8 | 10 | 16 }): boolean {
  if (char === "") {
    return false;
  }
  const value = Number.parseInt(char, 16);
  return !Number.isNaN(value) && value < radix;
}

/** Whether a character may continue an identifier, so it cannot touch a number's last digit. */
function isIdentifierPart({ char }: { char: string }): boolean {
  return char !== "" && /[\p{ID_Continue}$\p{Join_Control}]/u.test(char);
}

/** Refuse unless the cursor is on a digit of the radix, naming a misplaced `_` as such. */
function requireDigit({ cursor, radix }: { cursor: Cursor; radix: 2 | 8 | 10 | 16 }): void {
  const char = cursor.text.charAt(cursor.pos);
  if (isDigitOf({ char, radix })) {
    return;
  }
  const reason = radix === 16 ? "Hexadecimal digit expected." : "Digit expected.";
  fail({ at: cursor.pos, reason: char === "_" ? "Numeric separators are not allowed here." : reason });
}

/** Consume the `_` at the cursor, refused unless the next character is a digit of the radix. */
function scanSeparator({ cursor, radix }: { cursor: Cursor; radix: 2 | 8 | 10 | 16 }): void {
  const next = cursor.text.charAt(cursor.pos + 1);
  if (next === "_") {
    fail({ at: cursor.pos + 1, reason: "Multiple consecutive numeric separators are not permitted." });
  }
  if (!isDigitOf({ char: next, radix })) {
    fail({ at: cursor.pos, reason: "Numeric separators are not allowed here." });
  }
  cursor.pos += 1;
}

/** Consume one or more digits of a radix, a single `_` allowed only between two of them. */
function scanDigits({ cursor, radix }: { cursor: Cursor; radix: 2 | 8 | 10 | 16 }): void {
  const { text } = cursor;
  requireDigit({ cursor, radix });
  while (cursor.pos < text.length) {
    const char = text.charAt(cursor.pos);
    if (isDigitOf({ char, radix })) {
      cursor.pos += 1;
    } else if (char === "_") {
      scanSeparator({ cursor, radix });
    } else {
      return;
    }
  }
}

/** The radix a `0x`/`0o`/`0b` prefix names, or `undefined` for none. */
function prefixedRadix({ prefix }: { prefix: string }): 2 | 8 | 16 | undefined {
  const lower = prefix.toLowerCase();
  if (lower === "0x") {
    return 16;
  }
  if (lower === "0o") {
    return 8;
  }
  if (lower === "0b") {
    return 2;
  }
  return undefined;
}

/** Consume a decimal literal's integer part: a lone `0`, digits, or nothing before a leading `.`. */
function scanIntegerPart({ cursor }: { cursor: Cursor }): void {
  const { text } = cursor;
  const first = text.charAt(cursor.pos);
  if (first === ".") {
    return;
  }
  if (first !== "0") {
    scanDigits({ cursor, radix: 10 });
    return;
  }
  const next = text.charAt(cursor.pos + 1);
  if (isDigitOf({ char: next, radix: 10 })) {
    fail({ at: cursor.pos, reason: "Decimals with leading zeros and octal literals are not allowed." });
  }
  if (next === "_") {
    fail({ at: cursor.pos + 1, reason: "Numeric separators are not allowed here." });
  }
  cursor.pos += 1;
}

/** Consume a `.` and the fraction digits after it, if any; `5.` is a whole literal. */
function scanFraction({ cursor }: { cursor: Cursor }): void {
  const { text } = cursor;
  if (text.charAt(cursor.pos) !== ".") {
    return;
  }
  cursor.pos += 1;
  const next = text.charAt(cursor.pos);
  if (isDigitOf({ char: next, radix: 10 }) || next === "_") {
    scanDigits({ cursor, radix: 10 });
  }
}

/** Consume an `e`/`E` exponent with its optional sign, which must be followed by digits. */
function scanExponent({ cursor }: { cursor: Cursor }): void {
  const { text } = cursor;
  const marker = text.charAt(cursor.pos);
  if (marker !== "e" && marker !== "E") {
    return;
  }
  cursor.pos += 1;
  const sign = text.charAt(cursor.pos);
  if (sign === "+" || sign === "-") {
    cursor.pos += 1;
  }
  scanDigits({ cursor, radix: 10 });
}

/**
 * Read one unsigned numeric literal starting at a digit or a `.` followed by one, refusing every spelling TypeScript
 * refuses (a leading zero, a misplaced separator, an identifier touching the last digit).
 *
 * @returns the literal's value
 */
export function scanNumber({ cursor }: { cursor: Cursor }): number {
  const { text } = cursor;
  const start = cursor.pos;
  const radix = prefixedRadix({ prefix: text.slice(start, start + 2) });
  if (radix === undefined) {
    scanIntegerPart({ cursor });
    scanFraction({ cursor });
    scanExponent({ cursor });
  } else {
    cursor.pos += 2;
    scanDigits({ cursor, radix });
  }
  if (isIdentifierPart({ char: text.charAt(cursor.pos) })) {
    fail({ at: cursor.pos, reason: "An identifier or keyword cannot immediately follow a numeric literal." });
  }
  return Number(text.slice(start, cursor.pos).replaceAll("_", ""));
}

/**
 * Whether the character at an offset starts a numeric literal.
 *
 * @returns true for a digit, or a `.` with a digit straight after it
 */
export function startsNumber({ text, at }: { text: string; at: number }): boolean {
  const char = text.charAt(at);
  if (char === ".") {
    return isDigitOf({ char: text.charAt(at + 1), radix: 10 });
  }
  return isDigitOf({ char, radix: 10 });
}

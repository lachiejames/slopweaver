/**
 * Double-quoted string literals as TypeScript's scanner reads them in a `tsconfig.json`: every JavaScript escape
 * (`\x41`, `\u0041`, `\u{1F600}`, a line continuation) decoded, an octal escape or a raw line break refused.
 */
import { type Cursor, fail, isDigitOf, isLineBreak } from "./tsconfigScan.js";

/** Read exactly `count` hex digits as one code unit's value. */
function scanFixedHex({ cursor, count }: { cursor: Cursor; count: number }): number {
  const digits = cursor.text.slice(cursor.pos, cursor.pos + count);
  if (digits.length !== count || !/^[\da-f]+$/iu.test(digits)) {
    fail({ at: cursor.pos, reason: "Hexadecimal digit expected." });
  }
  cursor.pos += count;
  return Number.parseInt(digits, 16);
}

/** Read a `\u{…}` escape's digits and closing brace, the cursor just past the `{`. */
function scanExtendedUnicode({ cursor }: { cursor: Cursor }): string {
  const { text } = cursor;
  const start = cursor.pos;
  while (isDigitOf({ char: text.charAt(cursor.pos), radix: 16 })) {
    cursor.pos += 1;
  }
  if (cursor.pos === start) {
    fail({ at: cursor.pos, reason: "Hexadecimal digit expected." });
  }
  const value = Number.parseInt(text.slice(start, cursor.pos), 16);
  if (value > 0x10ffff) {
    fail({ at: start, reason: "An extended Unicode escape value must be between 0x0 and 0x10FFFF inclusive." });
  }
  if (text.charAt(cursor.pos) !== "}") {
    fail({ at: cursor.pos, reason: "'}' expected." });
  }
  cursor.pos += 1;
  return String.fromCodePoint(value);
}

/** The single-character escapes, each to the character it stands for. */
const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

/** Read an escape that starts with a digit: only a `\0` not followed by another digit is allowed. */
function scanDigitEscape({ cursor }: { cursor: Cursor }): string {
  const { text } = cursor;
  const at = cursor.pos;
  const char = text.charAt(at);
  if (char === "0" && !isDigitOf({ char: text.charAt(at + 1), radix: 10 })) {
    cursor.pos += 1;
    return "\0";
  }
  if (char === "8" || char === "9") {
    fail({ at, reason: `Escape sequence '\\${char}' is not allowed.` });
  }
  return fail({ at, reason: "Octal escape sequences are not allowed." });
}

/** Read a `\u` escape, the cursor on its `u`: four hex digits, or a braced code point. */
function scanUnicodeEscape({ cursor }: { cursor: Cursor }): string {
  cursor.pos += 1;
  if (cursor.text.charAt(cursor.pos) === "{") {
    cursor.pos += 1;
    return scanExtendedUnicode({ cursor });
  }
  return String.fromCharCode(scanFixedHex({ count: 4, cursor }));
}

/** How many characters a line continuation spans at `at` — two for CRLF, one for any other break, zero for none. */
function lineContinuationLength({ text, at }: { text: string; at: number }): number {
  const char = text.charAt(at);
  if (char === "\r" && text.charAt(at + 1) === "\n") {
    return 2;
  }
  return isLineBreak({ char }) ? 1 : 0;
}

/** Read one escape sequence, the cursor just past its backslash; a line continuation reads as nothing. */
function scanEscape({ cursor }: { cursor: Cursor }): string {
  const { text } = cursor;
  const at = cursor.pos;
  const char = text.charAt(at);
  if (char === "") {
    fail({ at, reason: "Unterminated string literal." });
  }
  if (isDigitOf({ char, radix: 10 })) {
    return scanDigitEscape({ cursor });
  }
  const simple = SIMPLE_ESCAPES.get(char);
  if (simple !== undefined) {
    cursor.pos += 1;
    return simple;
  }
  if (char === "x") {
    cursor.pos += 1;
    return String.fromCharCode(scanFixedHex({ count: 2, cursor }));
  }
  if (char === "u") {
    return scanUnicodeEscape({ cursor });
  }
  const continuation = lineContinuationLength({ at, text });
  if (continuation > 0) {
    cursor.pos += continuation;
    return "";
  }
  const whole = String.fromCodePoint(text.codePointAt(at)!);
  cursor.pos += whole.length;
  return whole;
}

/**
 * Read one double-quoted string, the cursor on its opening quote, leaving the cursor just past its closing one.
 *
 * @returns the string's value, every escape decoded
 */
export function scanString({ cursor }: { cursor: Cursor }): string {
  const { text } = cursor;
  cursor.pos += 1;
  let value = "";
  for (;;) {
    const char = text.charAt(cursor.pos);
    if (char === "" || char === "\n" || char === "\r") {
      fail({ at: cursor.pos, reason: "Unterminated string literal." });
    }
    if (char === '"') {
      cursor.pos += 1;
      return value;
    }
    if (char === "\\") {
      cursor.pos += 1;
      value += scanEscape({ cursor });
      continue;
    }
    value += char;
    cursor.pos += 1;
  }
}

/**
 * Read a `tsconfig.json`'s TEXT the way the TypeScript compiler reads one — JSON with `//` and `/* *\/` comments,
 * trailing commas, a leading `#!` line, and every number and string spelled as a JavaScript literal (`0x10`, `.5`,
 * `1_000`, `"\x41"`, `"\u{1F600}"`) — with no TypeScript at all. TypeScript 6 answered this in process through
 * `parseConfigFileTextToJson`; TypeScript 7 has no in-process parser, so the dialect is read here, and every input
 * `src/__tests__/unit/lib/tsconfigText.test.ts` pins was measured against TypeScript 6's own answer first.
 *
 * Three divergences, all deliberate, all REFUSED where TypeScript 6 read a value:
 *
 * - A `"__proto__"` key. TypeScript 6 assigns it, which replaces the parsed object's prototype rather than adding a
 *   property, so a config carrying one has nothing a caller here could read.
 * - Nesting past {@link MAX_DEPTH}. TypeScript 6 accepts a structure 900 levels deep and THROWS a `RangeError` at
 *   1,000 (repro: `parseConfigFileTextToJson("t.json", '{"a":' + "[".repeat(1000) + "]".repeat(1000) + "}")`), so the
 *   guard trades acceptance of 257 levels up to that limit, which no real config reaches, for a typed refusal where
 *   TypeScript 6 would crash its caller.
 * - TypeScript-only member syntax: a modifier keyword before a key (`readonly "a": 1`, `public static "a": 1`) or a
 *   definite-assignment `!` after one (`"a"!: 1`). TypeScript 6 parsed the text as an object LITERAL, which takes
 *   both, and only its checker, which this API never ran, rejects them (repro: `parseConfigFileTextToJson("t.json",
 *   '{readonly "a"!:1}')` reads `{"a":1}`). Matching it would mean porting TypeScript's modifier grammar, line-break
 *   rules included (`static` may end a line before its key, `readonly` may not), for text that is not a config.
 */
import { err, ok, type Result } from "./result.js";
import {
  type Cursor,
  fail,
  isLineBreak,
  SyntaxFailure,
  scanNumber,
  skipLine,
  skipTrivia,
  startsNumber,
} from "./tsconfigScan.js";
import { scanString } from "./tsconfigString.js";

/** The text is not a config TypeScript would read: `message` names what was wrong and where. */
interface TsconfigTextSyntaxError {
  readonly code: "TSCONFIG_TEXT_SYNTAX";
  readonly message: string;
  /** One-based line of the offending character. */
  readonly line: number;
  /** One-based column of the offending character. */
  readonly column: number;
}

/** Why a config text could not be read. */
export type TsconfigTextError = TsconfigTextSyntaxError;

/** The {@link TsconfigTextError} factories. */
const TsconfigTextErrors = {
  syntax: ({ reason, line, column }: { reason: string; line: number; column: number }): TsconfigTextSyntaxError => ({
    code: "TSCONFIG_TEXT_SYNTAX",
    column,
    line,
    message: `line ${line}, column ${column}: ${reason}`,
  }),
} as const;

/** A nesting depth no real config reaches, so a hostile one is refused rather than overflowing the stack. */
const MAX_DEPTH = 256;

const PROPERTY_VALUE_EXPECTED =
  "Property value can only be string literal, numeric literal, 'true', 'false', 'null', object literal or array literal.";

/** The three keyword values. */
const KEYWORD_VALUES: ReadonlyMap<string, boolean | null> = new Map([
  ["false", false],
  ["null", null],
  ["true", true],
]);

/** Read one value of any kind, the cursor on its first character. */
function readValue({ cursor, depth }: { cursor: Cursor; depth: number }): unknown {
  const { text } = cursor;
  const char = text.charAt(cursor.pos);
  if (char === "{") {
    return readObject({ cursor, depth: depth + 1 });
  }
  if (char === "[") {
    return readArray({ cursor, depth: depth + 1 });
  }
  if (char === '"') {
    return scanString({ cursor });
  }
  if (char === "-") {
    cursor.pos += 1;
    skipTrivia({ cursor });
    if (!startsNumber({ at: cursor.pos, text })) {
      fail({ at: cursor.pos, reason: PROPERTY_VALUE_EXPECTED });
    }
    return -scanNumber({ cursor });
  }
  if (startsNumber({ at: cursor.pos, text })) {
    return scanNumber({ cursor });
  }
  const word = /^[\p{ID_Continue}$]*/u.exec(text.slice(cursor.pos))![0];
  const keyword = KEYWORD_VALUES.get(word);
  if (keyword === undefined) {
    fail({ at: cursor.pos, reason: PROPERTY_VALUE_EXPECTED });
  }
  cursor.pos += word.length;
  return keyword;
}

/** Refuse a structure nested past {@link MAX_DEPTH}. */
function guardDepth({ cursor, depth }: { cursor: Cursor; depth: number }): void {
  if (depth > MAX_DEPTH) {
    fail({ at: cursor.pos, reason: `nesting deeper than ${MAX_DEPTH} levels` });
  }
}

/** Consume an opening bracket and the trivia after it; true when the structure closes straight away. */
function opensEmpty({ cursor, close }: { cursor: Cursor; close: "}" | "]" }): boolean {
  cursor.pos += 1;
  skipTrivia({ cursor });
  if (cursor.text.charAt(cursor.pos) !== close) {
    return false;
  }
  cursor.pos += 1;
  return true;
}

/** After one entry, consume its `,` or the closing bracket; true once closed, a trailing comma allowed. */
function closesAfterEntry({ cursor, close }: { cursor: Cursor; close: "}" | "]" }): boolean {
  const { text } = cursor;
  skipTrivia({ cursor });
  const separator = text.charAt(cursor.pos);
  cursor.pos += 1;
  if (separator === close) {
    return true;
  }
  if (separator !== ",") {
    fail({ at: cursor.pos - 1, reason: "',' expected." });
  }
  skipTrivia({ cursor });
  if (text.charAt(cursor.pos) !== close) {
    return false;
  }
  cursor.pos += 1;
  return true;
}

/** Read one `"key": value` member into `result`, the cursor on the key's opening quote. */
function readMember({
  cursor,
  depth,
  result,
}: {
  cursor: Cursor;
  depth: number;
  result: Record<string, unknown>;
}): void {
  const { text } = cursor;
  if (text.charAt(cursor.pos) !== '"') {
    fail({ at: cursor.pos, reason: "String literal with double quotes expected." });
  }
  const keyAt = cursor.pos;
  const key = scanString({ cursor });
  if (key === "__proto__") {
    fail({ at: keyAt, reason: "a '__proto__' key would replace the object's prototype" });
  }
  skipTrivia({ cursor });
  if (text.charAt(cursor.pos) !== ":") {
    fail({ at: cursor.pos, reason: "':' expected." });
  }
  cursor.pos += 1;
  skipTrivia({ cursor });
  result[key] = readValue({ cursor, depth });
}

/** Read one object, the cursor on its `{`; a trailing comma is allowed, an empty slot is not. */
function readObject({ cursor, depth }: { cursor: Cursor; depth: number }): Record<string, unknown> {
  guardDepth({ cursor, depth });
  const result: Record<string, unknown> = {};
  if (opensEmpty({ close: "}", cursor })) {
    return result;
  }
  do {
    readMember({ cursor, depth, result });
  } while (!closesAfterEntry({ close: "}", cursor }));
  return result;
}

/** Read one array, the cursor on its `[`; a trailing comma is allowed, a hole is not. */
function readArray({ cursor, depth }: { cursor: Cursor; depth: number }): unknown[] {
  guardDepth({ cursor, depth });
  const result: unknown[] = [];
  if (opensEmpty({ close: "]", cursor })) {
    return result;
  }
  do {
    if (cursor.text.charAt(cursor.pos) === ",") {
      fail({ at: cursor.pos, reason: PROPERTY_VALUE_EXPECTED });
    }
    result.push(readValue({ cursor, depth }));
  } while (!closesAfterEntry({ close: "]", cursor }));
  return result;
}

/** One-based line and column of an offset, counting a CRLF as one break. */
function lineAndColumn({ text, at }: { text: string; at: number }): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < at; index += 1) {
    const char = text.charAt(index);
    const crlf = char === "\r" && text.charAt(index + 1) === "\n";
    if (isLineBreak({ char }) && !crlf) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { column: at - lineStart + 1, line };
}

/**
 * Parse a `tsconfig.json` text as TypeScript reads one. An empty text, or one holding only comments, reads as `{}`,
 * exactly as TypeScript 6 read it; any other root that is not an object is refused.
 *
 * @param text the file's contents
 * @returns the parsed object, or the first reason the text is not a config, with its line and column
 */
export function parseTsconfigText({ text }: { text: string }): Result<Record<string, unknown>, TsconfigTextError> {
  const cursor: Cursor = { pos: 0, text };
  try {
    if (text.startsWith("#!")) {
      skipLine({ cursor });
    }
    skipTrivia({ cursor });
    if (cursor.pos === text.length) {
      return ok({});
    }
    if (text.charAt(cursor.pos) !== "{") {
      fail({ at: cursor.pos, reason: "The root value of a tsconfig file must be an object." });
    }
    const value = readObject({ cursor, depth: 1 });
    skipTrivia({ cursor });
    if (cursor.pos !== text.length) {
      fail({ at: cursor.pos, reason: "Unexpected token." });
    }
    return ok(value);
  } catch (thrown) {
    if (!(thrown instanceof SyntaxFailure)) {
      throw thrown;
    }
    return err(TsconfigTextErrors.syntax({ reason: thrown.message, ...lineAndColumn({ at: thrown.at, text }) }));
  }
}

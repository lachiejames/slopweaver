/**
 * The TypeScript-free tsconfig reader. Every expected value below is TypeScript 6's own answer from
 * `parseConfigFileTextToJson` on the same text, measured before this reader replaced it; the three classes where the
 * two differ on purpose (a `"__proto__"` key, nesting past the depth bound, and TypeScript-only member syntax) are
 * pinned as refusals.
 */

import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { parseTsconfigText } from "#lib/tsconfigText.js";

/** Non-ASCII inputs built from their code points, so this file stays ASCII and no reader is handed an invisible byte. */
const GRINNING_FACE = String.fromCodePoint(0x1f600);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** Texts TypeScript 6 read, and the value it read each as. */
const ACCEPTED: readonly (readonly [string, unknown])[] = [
  ["", {}],
  ["   ", {}],
  ["// only a comment", {}],
  ["{}", {}],
  ['{"a":1,}', { a: 1 }],
  ['{"a":[1,2,],}', { a: [1, 2] }],
  ['{"a":0x10}', { a: 16 }],
  ['{"a":0X1f}', { a: 31 }],
  ['{"a":0o17}', { a: 15 }],
  ['{"a":0b101}', { a: 5 }],
  ['{"a":.5}', { a: 0.5 }],
  ['{"a":5.}', { a: 5 }],
  ['{"a":1_000}', { a: 1000 }],
  ['{"a":1E-3}', { a: 0.001 }],
  ['{"a":1.5e+2}', { a: 150 }],
  ['{"a":- 1}', { a: -1 }],
  ['{"a":-/*c*/1}', { a: -1 }],
  ['{"a":-0x10}', { a: -16 }],
  ['{"a":true,"b":false,"c":null}', { a: true, b: false, c: null }],
  ['{"a":"\\x41"}', { a: "A" }],
  ['{"a":"\\u{1F600}"}', { a: GRINNING_FACE }],
  ['{"a":"\\n\\t\\r\\b\\f\\v\\0"}', { a: "\n\t\r\b\f\v\0" }],
  ['{"a":"\\/\\\'\\q"}', { a: "/'q" }],
  ['{"a":"line\\\ncontinued"}', { a: "linecontinued" }],
  [`{"a":"ls${LINE_SEPARATOR}here"}`, { a: `ls${LINE_SEPARATOR}here` }],
  ['/* block */ {"a":1} // trailing', { a: 1 }],
  ['{"a" /* c */ : /* d */ 1}', { a: 1 }],
  [`${BYTE_ORDER_MARK}{"a":1}`, { a: 1 }],
  [`${NO_BREAK_SPACE}{"a":1}${LINE_SEPARATOR}`, { a: 1 }],
  ['#!shebang\n{"a":1}', { a: 1 }],
  ['{"a":1,"a":2}', { a: 2 }],
  ['{"a":{"b":{"c":[{"d":null}]}}}', { a: { b: { c: [{ d: null }] } } }],
];

/** TypeScript-only member syntax TypeScript 6 read as `{"a":1}`, refused here on purpose (the reader's header). */
const MEMBER_SYNTAX: readonly string[] = [
  '{"a"!:1}',
  '{"a" /*c*/ ! /*c*/ :1}',
  '{readonly "a":1}',
  '{public static "a":1}',
  '{"b":2, export "a":1}',
  '{readonly "a"!:1}',
];

/** Texts TypeScript 6 refused, and a fragment of the reason this reader gives. */
const REFUSED: readonly (readonly [string, string])[] = [
  ["[]", "root value"],
  ["null", "root value"],
  ["{} {}", "Unexpected token"],
  ['{"a":1}}', "Unexpected token"],
  ['{"a":1,,}', "double quotes expected"],
  ['{"a":[1,,2]}', "Property value can only be"],
  ["{'a':1}", "double quotes expected"],
  ["{\"a\":'x'}", "Property value can only be"],
  ["{a:1}", "double quotes expected"],
  ['{"a":`x`}', "Property value can only be"],
  ['{"a"}', "':' expected"],
  ['{"a"?:1}', "':' expected"],
  ['{"a"!!:1}', "':' expected"],
  ['{"a"!?:1}', "':' expected"],
  ['{"a"!}', "':' expected"],
  ['{"a":1 "b":2}', "',' expected"],
  ['{"a":1__0}', "Multiple consecutive numeric separators"],
  ['{"a":1_}', "Numeric separators are not allowed here"],
  ['{"a":0x_1}', "Numeric separators are not allowed here"],
  ['{"a":1e}', "Digit expected"],
  ['{"a":017}', "leading zeros and octal"],
  ['{"a":08}', "leading zeros and octal"],
  ['{"a":+1}', "Property value can only be"],
  ['{"a":--1}', "Property value can only be"],
  ['{"a":1n}', "cannot immediately follow a numeric literal"],
  ['{"a":NaN}', "Property value can only be"],
  ['{"a":-Infinity}', "Property value can only be"],
  ['{"a":True}', "Property value can only be"],
  ['{"a":(1)}', "Property value can only be"],
  ['{"a":"\\01"}', "Octal escape sequences"],
  ['{"a":"\\8"}', "Escape sequence '\\8' is not allowed"],
  ['{"a":"\\x4"}', "Hexadecimal digit expected"],
  ['{"a":"\\u{110000}"}', "between 0x0 and 0x10FFFF"],
  ['{"a":"raw\nnewline"}', "Unterminated string literal"],
  ['{"a":1} /* unterminated', "'*/' expected"],
  ["<!-- -->{}", "root value"],
];

describe("parseTsconfigText", () => {
  it.each(ACCEPTED)("reads %j as TypeScript 6 did", (text, expected) => {
    expect(unwrap(parseTsconfigText({ text }))).toEqual(expected);
  });

  it.each(REFUSED)("refuses %j, as TypeScript 6 did", (text, reason) => {
    const error = unwrapErr(parseTsconfigText({ text }));
    expect(error.code).toBe("TSCONFIG_TEXT_SYNTAX");
    expect(error.message).toContain(reason);
  });

  it.each(MEMBER_SYNTAX)("refuses %j, TypeScript-only member syntax TypeScript 6's parser let through", (text) => {
    const error = unwrapErr(parseTsconfigText({ text }));
    expect(error.code).toBe("TSCONFIG_TEXT_SYNTAX");
  });

  it("refuses a __proto__ key, where TypeScript 6 replaced the object's prototype", () => {
    const error = unwrapErr(parseTsconfigText({ text: '{"__proto__":{"x":1}}' }));
    expect(error.message).toBe("line 1, column 2: a '__proto__' key would replace the object's prototype");
  });

  it("names the line and column of the offending character, counting a CRLF as one break", () => {
    const error = unwrapErr(parseTsconfigText({ text: '{\r\n  "a": 1,\r\n  b: 2\r\n}' }));
    expect(error.line).toBe(3);
    expect(error.column).toBe(3);
  });

  it("refuses nesting past its depth bound instead of overflowing the stack", () => {
    const text = `{"a":${"[".repeat(300)}${"]".repeat(300)}}`;
    expect(unwrapErr(parseTsconfigText({ text })).message).toContain("nesting deeper than 256 levels");
  });
});

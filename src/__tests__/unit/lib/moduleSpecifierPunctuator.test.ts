/**
 * `punctuatorLength`: how many characters the punctuator at a position spans, by context-free maximal munch — the
 * longest punctuator the characters spell, before any re-scan TypeScript's parser makes by context.
 */

import { describe, expect, it } from "vitest";
import { punctuatorLength } from "#lib/moduleSpecifierPunctuator.js";

/** The length of the punctuator opening `text`. */
function lengthOf({ text }: { text: string }): number {
  return punctuatorLength({ pos: 0, text });
}

describe("punctuatorLength", () => {
  it("takes one character for a bracket, separator or decorator sign", () => {
    expect(["{", "}", "(", ")", "[", "]", ";", ",", "~", ":", "@"].map((text) => lengthOf({ text }))).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it("doubles and assigns arithmetic and logical operators", () => {
    expect(
      ["+", "++", "+=", "-", "--", "&", "&&", "&=", "&&=", "<", "<<", "<=", "<<=", "**=", "||="].map((text) =>
        lengthOf({ text }),
      ),
    ).toEqual([1, 2, 2, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 3, 3]);
  });

  // A `//` never reaches it: the lexer skips a comment before asking, so a division is the only `/` measured here.
  it("never doubles `%` or `^`, and takes only `=` after a division's `/`", () => {
    expect(["/ /", "/a", "%%", "^^", "/=", "%=", "^="].map((text) => lengthOf({ text }))).toEqual([
      1, 1, 1, 1, 2, 2, 2,
    ]);
  });

  it("reads `?.` before a digit as a conditional, and `??=` whole", () => {
    expect(["?.5", "?.a", "??", "??=", "?"].map((text) => lengthOf({ text }))).toEqual([1, 2, 2, 3, 1]);
  });

  it("reads every shift right and its assignment whole, by maximal munch", () => {
    expect([">", ">=", ">>", ">>=", ">>>", ">>>="].map((text) => lengthOf({ text }))).toEqual([1, 2, 2, 3, 3, 4]);
  });

  it("reads a spread, an arrow and the equality family", () => {
    expect(["...", "..", ".", "=>", "=", "==", "===", "!", "!=", "!=="].map((text) => lengthOf({ text }))).toEqual([
      3, 1, 1, 2, 1, 2, 3, 1, 2, 3,
    ]);
  });

  it("measures from the given position, not the text's start", () => {
    expect(punctuatorLength({ pos: 2, text: "a >>= b" })).toBe(3);
  });

  it("answers 0 where no punctuator starts", () => {
    expect(["a", "1", "#", "\\", " "].map((text) => lengthOf({ text }))).toEqual([0, 0, 0, 0, 0]);
  });
});

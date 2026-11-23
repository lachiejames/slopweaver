/**
 * The tsconfig reader's lexical layer on its own: where each scanner leaves the cursor, and the TypeScript diagnostic
 * it stops on. The whole-text behaviour, pinned against TypeScript 6's answers, is `tsconfigText.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type Cursor, isLineBreak, scanNumber, skipTrivia, startsNumber } from "../../../lib/tsconfigScan.js";
import { scanString } from "../../../lib/tsconfigString.js";

/** A cursor at the start of a text. */
function at({ text }: { text: string }): Cursor {
  return { pos: 0, text };
}

describe("isLineBreak", () => {
  it("is true for the four JavaScript line terminators and nothing else", () => {
    const chars = ["\n", "\r", String.fromCharCode(0x2028), String.fromCharCode(0x2029), " ", "\t", ""];
    expect(chars.map((char) => isLineBreak({ char }))).toEqual([true, true, true, true, false, false, false]);
  });
});

describe("skipTrivia", () => {
  it("skips spaces, a byte-order mark and both comment forms, stopping on the first real character", () => {
    const cursor = at({ text: `${String.fromCharCode(0xfeff)} // line\n/* block */ {` });
    skipTrivia({ cursor });
    expect(cursor.pos).toBe(cursor.text.length - 1);
  });

  it("refuses an unterminated block comment", () => {
    expect(() => {
      skipTrivia({ cursor: at({ text: "/* never closed" }) });
    }).toThrow("'*/' expected.");
  });
});

describe("scanNumber", () => {
  it("reads every radix, a leading dot, separators and an exponent, leaving the cursor after the literal", () => {
    const read = ["0x1F,", "0o17,", "0b101,", ".5,", "1_000,", "1e-3,", "5.,"].map((text) => {
      const cursor = at({ text });
      return [scanNumber({ cursor }), cursor.pos];
    });
    expect(read).toEqual([
      [31, 4],
      [15, 4],
      [5, 5],
      [0.5, 2],
      [1000, 5],
      [0.001, 4],
      [5, 2],
    ]);
  });

  it("refuses a leading zero, a doubled separator and an identifier touching the last digit", () => {
    const reasons = ["01", "1__0", "1n"].map((text) => {
      try {
        scanNumber({ cursor: at({ text }) });
        return "accepted";
      } catch (thrown) {
        return (thrown as Error).message;
      }
    });
    expect(reasons).toEqual([
      "Decimals with leading zeros and octal literals are not allowed.",
      "Multiple consecutive numeric separators are not permitted.",
      "An identifier or keyword cannot immediately follow a numeric literal.",
    ]);
  });
});

describe("startsNumber", () => {
  it("is true for a digit or a dot before a digit, and false for a bare dot or a sign", () => {
    expect(["1", ".5", ".", "-1", "x"].map((text) => startsNumber({ at: 0, text }))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("scanString", () => {
  it("decodes every escape form and a line continuation, leaving the cursor past the closing quote", () => {
    const cursor = at({ text: '"\\x41\\u0042\\u{43}\\n\\\nD"!' });
    expect(scanString({ cursor })).toBe("ABC\nD");
    expect(cursor.pos).toBe(cursor.text.length - 1);
  });

  it("refuses an octal escape and a raw line break", () => {
    const reasons = ['"\\1"', '"a\nb"'].map((text) => {
      try {
        scanString({ cursor: at({ text }) });
        return "accepted";
      } catch (thrown) {
        return (thrown as Error).message;
      }
    });
    expect(reasons).toEqual(["Octal escape sequences are not allowed.", "Unterminated string literal."]);
  });
});

/**
 * The line-break class a one-line field refuses, a printed gauge line folds and a JSON document escapes — every
 * character a reader or a terminal may end a line on, not CR and LF alone.
 *
 * NEL and the two Unicode separators are built from code points rather than written as escapes: a raw U+2028 in
 * a source file breaks a JSON-lines reader of the diff (Codex's transport refused the review packet twice).
 */
import { describe, expect, it } from "vitest";

import { escapeJsonLineBreaks, foldLineBreaks, hasLineBreak } from "../../../lib/lineBreaks.js";

const [NEL, LINE_SEPARATOR, PARAGRAPH_SEPARATOR] = [0x85, 0x2028, 0x2029].map((point) => String.fromCodePoint(point));
const EVERY_BREAK = ["\r", "\n", "\v", "\f", NEL!, LINE_SEPARATOR!, PARAGRAPH_SEPARATOR!];
const BACKSLASH = String.fromCharCode(92);

describe("hasLineBreak", () => {
  it("finds each line-break character in an address", () => {
    expect(EVERY_BREAK.map((one) => hasLineBreak({ text: `a@example.invalid${one}PLAN x: forged` }))).toStrictEqual(
      EVERY_BREAK.map(() => true),
    );
  });

  it("passes a one-line address, tabs and spaces included", () => {
    expect(hasLineBreak({ text: "a b\t@example.invalid" })).toBe(false);
  });

  it("gives the same answer when asked twice, so no regex state leaks between calls", () => {
    const text = "a@example.invalid\nPLAN x: forged";
    expect([hasLineBreak({ text }), hasLineBreak({ text })]).toStrictEqual([true, true]);
  });
});

describe("foldLineBreaks", () => {
  it("folds a table row whose cached address carries a CRLF into one physical line", () => {
    const row = "plan-one  cached@example.com\r\n  PLAN plan-two: forged  12%";
    expect(foldLineBreaks({ text: row })).toBe("plan-one  cached@example.com PLAN plan-two: forged  12%");
  });

  it("folds every line-break character, so no Unicode separator survives into the printed line", () => {
    expect(EVERY_BREAK.map((one) => foldLineBreaks({ text: `reason${one}PLAN x: forged` }))).toStrictEqual(
      EVERY_BREAK.map(() => "reason PLAN x: forged"),
    );
  });

  it("keeps a line with no break byte for byte, alignment padding included", () => {
    const row = "plan-one    40%   2026-11-05T00:00:00.000Z  ";
    expect(foldLineBreaks({ text: row })).toBe(row);
  });

  it("keeps an empty line empty", () => {
    expect(foldLineBreaks({ text: "" })).toBe("");
  });
});

describe("escapeJsonLineBreaks", () => {
  const problem = `timeout${LINE_SEPARATOR!}PLAN plan-evil: forged${NEL!}`;

  it("writes every line break JSON.stringify leaves raw as an escape, so the document is one physical line", () => {
    const escaped = escapeJsonLineBreaks({ json: JSON.stringify({ problem }) });
    expect(escaped).toBe(`{"problem":"timeout${BACKSLASH}u2028PLAN plan-evil: forged${BACKSLASH}u0085"}`);
    expect(hasLineBreak({ text: escaped })).toBe(false);
  });

  it("parses back to the same value", () => {
    const escaped = escapeJsonLineBreaks({ json: JSON.stringify({ problem }) });
    expect(JSON.parse(escaped)).toStrictEqual({ problem });
  });
});

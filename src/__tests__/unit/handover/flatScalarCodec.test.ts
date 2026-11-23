/**
 * A flat front-matter scalar reads back as the value written — the writer's encoder and the reader's decoder are
 * one codec.
 *
 * The defect these hold down: the writer JSON-escaped a multi-line value, the reader decoded only `\"` and `\\`, so a
 * written newline read back as the two visible characters `\n`. The round trip goes through the REAL reader
 * (`flatFields` + `flatValue`) and, for the writer, the real `askRowText` + `parseHandoverDoc`, so a reader that
 * stopped calling the decoder fails here rather than only in the codec's own cases.
 */
import { describe, expect, it } from "vitest";

import { askRowText } from "../../../cli/commands/handover/askRowText.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { flatFields, flatValue } from "../../../handover/docFlat.js";
import { decodeFlatScalar, encodeFlatScalar } from "../../../handover/flatScalarCodec.js";

/** U+0085, U+2028 and U+2029, built from code points so this file carries none of the raw characters. */
const NEXT_LINE = String.fromCharCode(0x85);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

/** One value through the encoder, onto a front-matter line, and back out through the flat reader. */
const roundTrip = ({ value }: { value: string }): string | undefined =>
  flatValue({ fields: flatFields({ lines: [`branch: ${encodeFlatScalar({ value })}`] }).fields, key: "branch" });

/** Whether a written scalar would span more than one line to a reader or an editor. */
const spansLines = ({ written }: { written: string }): boolean =>
  [/\n/u, /\r/u].some((pattern) => pattern.test(written)) ||
  written.includes(NEXT_LINE) ||
  written.includes(LINE_SEPARATOR) ||
  written.includes(PARAGRAPH_SEPARATOR);

/** Every value the encoder quotes, each one a shape the old reader returned wrong or could have. */
const QUOTED_VALUES: readonly string[] = [
  "feature/one\nproblem: injected",
  "carriage\rreturn",
  "crlf\r\nline",
  "tab\tafter a newline\n",
  '"leading double quote',
  "'leading single quote",
  "a literal backslash-n \\n beside a real\nnewline",
  'an escaped quote \\" beside a real "quote"\n',
  "trailing backslash\n\\",
  `control ${String.fromCharCode(0x01)} and ${String.fromCharCode(0x1f)}\n`,
  `astral ${String.fromCodePoint(0x1f600)} and ${String.fromCharCode(0xe9)}\n`,
  `lone high surrogate ${String.fromCharCode(0xd800)} here\n`,
  "solidus / and backspace \b and formfeed \f\n",
  // A bare value loses whitespace at either end, because the reader trims what follows the colon.
  "trailing space ",
  " leading space",
  "trailing tab\t",
  // A bare lone `>`/`|` is read as a block indicator, and the value is lost.
  ">",
  "|-",
  // Unicode line and paragraph separators, which an editor draws as a line break.
  `a${LINE_SEPARATOR}problem: injected`,
  `b${PARAGRAPH_SEPARATOR}lean: injected`,
  // U+0085 NEXT LINE, which JSON.stringify leaves raw and JavaScript's `\s` does not match.
  `c${NEXT_LINE}problem: injected`,
];

describe("encodeFlatScalar + decodeFlatScalar are one codec", () => {
  it("opens on a non-empty case list, so the loop below cannot pass over nothing", () => {
    expect(QUOTED_VALUES.length).toBeGreaterThan(0);
  });

  it.each(QUOTED_VALUES)("reads %j back exactly, through the real flat reader", (value) => {
    expect(roundTrip({ value })).toBe(value);
  });

  it("writes every one of those values QUOTED, on one line, so the round trip above crossed the escape set", () => {
    const unquoted = QUOTED_VALUES.filter((value) => {
      const written = encodeFlatScalar({ value });
      return !written.startsWith('"') || spansLines({ written });
    });
    expect(unquoted).toEqual([]);
  });

  // The one value outside the round trip, by design — an empty field means unset.
  it("reads an empty value back as absent, bare or quoted", () => {
    expect([
      roundTrip({ value: "" }),
      flatValue({ fields: flatFields({ lines: ['branch: ""'] }).fields, key: "branch" }),
    ]).toEqual([undefined, undefined]);
  });

  it("writes a Unicode line separator as its \\u escape", () => {
    expect(encodeFlatScalar({ value: `a${LINE_SEPARATOR}b` })).toBe('"a\\u2028b"');
  });

  it("decodes a written newline and tab as the characters, not as a backslash sequence", () => {
    expect(decodeFlatScalar({ value: '"one\\ntwo\\tthree"' })).toBe("one\ntwo\tthree");
  });

  it("decodes an escaped backslash before an n as a backslash and an n, in one pass", () => {
    expect(decodeFlatScalar({ value: '"C:\\\\new"' })).toBe("C:\\new");
  });

  it("decodes a \\u escape to its code unit", () => {
    expect(decodeFlatScalar({ value: '"bell \\u0007 here"' })).toBe(`bell ${String.fromCharCode(0x07)} here`);
  });

  it("decodes an escaped solidus, which JSON allows though JSON.stringify never writes one", () => {
    expect(decodeFlatScalar({ value: '"a\\/b"' })).toBe("a/b");
  });

  it("keeps an escape outside JSON's set verbatim, so a hand-written path reads as it always has", () => {
    expect(decodeFlatScalar({ value: '"C:\\path\\x41"' })).toBe("C:\\path\\x41");
  });

  it("returns a hand-written value that is not valid JSON as its text, rather than throwing", () => {
    expect(decodeFlatScalar({ value: '"they said "hi" twice"' })).toBe('they said "hi" twice');
  });

  it("collapses YAML's doubled quote inside a single-quoted value", () => {
    expect(decodeFlatScalar({ value: "'it''s'" })).toBe("it's");
  });

  it("writes an ordinary value bare and reads it back unchanged", () => {
    expect(encodeFlatScalar({ value: "feature/one" })).toBe("feature/one");
    expect(roundTrip({ value: "feature/one" })).toBe("feature/one");
  });
});

describe("a registered row reads back the values it was written with", () => {
  // The flat layer round-trips every field exactly; `parseHandoverDoc` then holds all but `summary` to one line,
  // because its readers print rows (`doc/proseOneLine.test.ts`).
  it("round-trips a newline-bearing branch and summary written by askRowText, the doc holding the branch to one line", () => {
    const branch = "feature/one\nsecond\tline";
    const ask = 'restore "the" row:\nwith a tab\there';
    const text = askRowText({
      anchor: undefined,
      ask,
      askedIso: "2026-09-19T12:00:00.000Z",
      branch,
      checkedIso: "2026-08-30T23:10:00Z",
      dispatch: true,
      finding: undefined,
      priority: undefined,
      repo: undefined,
      shape: undefined,
      slug: "round-trip-row",
    });
    const front = text.split("\n").slice(1, text.split("\n").indexOf("---", 1));
    expect(flatValue({ fields: flatFields({ lines: front }).fields, key: "branch" })).toBe(branch);
    const doc = parseHandoverDoc({ path: "/state/handovers/round-trip-row.md", text });
    expect(doc.branch).toBe("feature/one second line");
    expect(doc.summary).toBe(ask);
  });
});

import { describe, expect, it } from "vitest";

import { replayScreen } from "../../../claude/mintScreen.js";

const replay = ({ raw, columns = 40, rows = 5 }: { raw: string; columns?: number; rows?: number }) =>
  replayScreen({ columns, raw, rows });

describe("replayScreen", () => {
  it("leaves the cells a CHA jump skipped blank, rather than gluing the words (2.1.285's banner)", () => {
    expect(replay({ raw: "Welcome\u001b[9Gto\u001b[12GClaude\r\r\n" })).toEqual(["Welcome to Claude", ""]);
  });

  it("keeps an old cell a cursor-forward skipped when a row is overdrawn", () => {
    expect(replay({ raw: "abcdef\r\u001b[1CX\u001b[2CY" })).toEqual(["aXcdYf"]);
  });

  it("returns up a row and overdraws only the cells it writes", () => {
    expect(replay({ raw: "first line\r\r\nsecond\r\u001b[1AFIRST" })).toEqual(["FIRST line", "second"]);
  });

  it("erases to the end of the line, the start of it, and the whole of it", () => {
    expect(replay({ raw: "abcdef\u001b[4G\u001b[K" })).toEqual(["abc"]);
    expect(replay({ raw: "abcdef\u001b[3G\u001b[1K" })).toEqual(["   def"]);
    expect(replay({ raw: "abcdef\u001b[2K" })).toEqual([""]);
  });

  it("erases characters in place with ECH", () => {
    expect(replay({ raw: "abcdef\u001b[2G\u001b[3X" })).toEqual(["a   ef"]);
  });

  it("clears the viewport on ED 2 and below the cursor on ED 0", () => {
    expect(replay({ raw: "one\r\ntwo\u001b[2J" })).toEqual(["", ""]);
    expect(replay({ raw: "one\r\ntwo\u001b[1;2H\u001b[J" })).toEqual(["o", ""]);
  });

  it("positions absolutely with CUP, 1-based within the viewport", () => {
    expect(replay({ raw: "\u001b[2;3Hx" })).toEqual(["", "  x"]);
  });

  it("never draws an OSC 8 hyperlink's URL, only its visible text", () => {
    expect(replay({ raw: "\u001b]8;id=1;https://example.invalid/a\u0007link\u001b]8;;\u0007 done" })).toEqual([
      "link done",
    ]);
  });

  it("ignores colour, private modes and queries, which put nothing on screen", () => {
    expect(replay({ raw: "\u001b[?2026h\u001b[>4;2m\u001b[<u\u001b[38;2;1;2;3mhi\u001b[39m\u001b[c" })).toEqual(["hi"]);
  });

  it("restores a saved cursor", () => {
    expect(replay({ raw: "ab\u001b7cd\r\nef\u001b8X" })).toEqual(["abXd", "ef"]);
  });

  it("wraps at the right edge, as a terminal's autowrap does", () => {
    expect(replay({ columns: 4, raw: "abcdef" })).toEqual(["abcd", "ef"]);
  });

  it("counts a wide character as two cells", () => {
    expect(replay({ raw: "日x\u001b[4Gy" })).toEqual(["日xy"]);
  });

  it("keeps scrolled-off rows as history, and cannot move up into them", () => {
    expect(replay({ raw: "a\r\nb\r\nc\u001b[5AZ", rows: 2 })).toEqual(["a", "bZ", "c"]);
  });

  it("erases above the cursor with ED 1, through the cursor's own cell", () => {
    expect(replay({ raw: "abc\r\ndef\u001b[2;2H\u001b[1J" })).toEqual(["", "  f"]);
  });

  it("moves down and back with CUD and CUB, and homes with a bare CUP", () => {
    expect(replay({ raw: "abc\u001b[2D\u001b[1BX" })).toEqual(["abc", " X"]);
    expect(replay({ raw: "abc\u001b[HZ" })).toEqual(["Zbc"]);
  });

  it("applies tab, backspace and a vertical tab as a terminal does", () => {
    expect(replay({ raw: "a\tb" })).toEqual(["a       b"]);
    expect(replay({ raw: "ab\bX" })).toEqual(["aX"]);
    expect(replay({ raw: "a\u000bb" })).toEqual(["a", " b"]);
  });

  it("skips charset designators, other two-byte escapes, a C1 control and a CSI with an intermediate", () => {
    expect(replay({ raw: "\u001b(B\u001bMa\u0085b\u001b[2 qc" })).toEqual(["abc"]);
  });

  it("ends a control string at ST as well as BEL", () => {
    expect(replay({ raw: "\u001b]0;a title\u001b\\ok" })).toEqual(["ok"]);
  });

  it("draws nothing for an escape the recording cut off mid-sequence", () => {
    expect(replay({ raw: "ok\u001b" })).toEqual(["ok"]);
    expect(replay({ raw: "ok\u001b[12" })).toEqual(["ok"]);
    expect(replay({ raw: "ok\u001b]8;;never ends" })).toEqual(["ok"]);
  });

  it("answers one empty line for an empty recording", () => {
    expect(replay({ raw: "" })).toEqual([""]);
  });
});

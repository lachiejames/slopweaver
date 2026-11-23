/**
 * A heredoc delimiter after the shell's quote removal, `$'…'` decoded the way bash decodes it — measured with
 * /bin/bash 3.2 on darwin, where `cat <<$'E\x4fF'` closes on a line reading `EOF`.
 */
import { describe, expect, it } from "vitest";

import { ansiCQuoted, delimiterWord, doubleQuoted, heredocLine } from "../../../admit/heredocDelimiter.js";

describe("delimiterWord", () => {
  it("removes every quoting the shell removes", () => {
    const spellings = ["EOF", "'EOF'", '"EOF"', "\\EOF", "E'O'F", "$'EOF'", '$"EOF"', "$'E\\x4fF'", "$'\\105OF'"];
    expect(spellings.map((text) => delimiterWord({ at: 0, command: text }).delimiter)).toEqual(
      spellings.map(() => "EOF"),
    );
  });

  it("removes a line continuation inside the word, leaving it unquoted", () => {
    expect(delimiterWord({ at: 0, command: "EO\\\nF\ndata" })).toEqual({
      dollarQuoted: false,
      delimiter: "EOF",
      end: 5,
      quoted: false,
    });
  });

  it("marks a quoted delimiter so its body is not expanded, a bare one as expanding, and a $'…' part", () => {
    expect(delimiterWord({ at: 0, command: "$'EOF'\nx" })).toEqual({
      dollarQuoted: true,
      delimiter: "EOF",
      end: 6,
      quoted: true,
    });
    expect(delimiterWord({ at: 0, command: "EOF\nx" })).toEqual({
      dollarQuoted: false,
      delimiter: "EOF",
      end: 3,
      quoted: false,
    });
    expect(delimiterWord({ at: 0, command: "'EOF'\nx" }).dollarQuoted).toBe(false);
    expect(delimiterWord({ at: 0, command: '"EOF"\nx' }).dollarQuoted).toBe(false);
    expect(delimiterWord({ at: 0, command: '$"EOF"\nx' }).dollarQuoted).toBe(true);
  });
});

describe("heredocLine", () => {
  it("joins an odd backslash run to the next line in an unquoted body, and nothing else", () => {
    expect(heredocLine({ at: 0, command: "tr\\\nue\nnext", fold: true })).toEqual({ end: 7, line: "true" });
    expect(heredocLine({ at: 0, command: "a\\\\\nb", fold: true })).toEqual({ end: 4, line: "a\\\\" });
    expect(heredocLine({ at: 0, command: "tr\\\nue\nnext", fold: false })).toEqual({ end: 4, line: "tr\\" });
    expect(heredocLine({ at: 0, command: "end\\", fold: true })).toEqual({ end: 4, line: "end\\" });
  });
});

describe("doubleQuoted", () => {
  it("removes a backslash only before $, backtick, quote, backslash or newline", () => {
    expect(doubleQuoted({ at: 0, command: 'E\\"OF" tail' })).toEqual({ end: 6, text: 'E"OF' });
    expect(doubleQuoted({ at: 0, command: 'a\\$b\\\\c\\qd"' }).text).toBe("a$b\\c\\qd");
    expect(doubleQuoted({ at: 0, command: "open" })).toEqual({ end: 4, text: "open" });
  });

  it("names the delimiter bash names for an escaped quote inside double quotes", () => {
    expect(delimiterWord({ at: 0, command: '"E\\"OF"\nx' }).delimiter).toBe('E"OF');
  });
});

describe("ansiCQuoted", () => {
  it("decodes the simple, octal, hex, unicode and control escapes, and keeps an unknown one", () => {
    expect(ansiCQuoted({ at: 0, command: "a\\tb\\101\\x42\\u0043\\cA\\q'" }).text).toBe("a\tbABC\u0001\\q");
  });

  it("cuts the string at a NUL in any spelling, as a shell word must", () => {
    const nuls = ["\\0'", "a\\x00b'", "a\\u0000b'", "a\\c@b'"];
    expect(nuls.map((command) => ansiCQuoted({ at: 0, command }).text)).toEqual(["", "a", "a", "a"]);
  });

  it("wraps an octal escape to one byte, so \\400 is a NUL and \\501 is A", () => {
    expect(ansiCQuoted({ at: 0, command: "\\400'" }).text).toBe("");
    expect(ansiCQuoted({ at: 0, command: "\\501'" }).text).toBe("A");
  });

  it("keeps a \\U escape past the last code point literal rather than throwing", () => {
    expect(ansiCQuoted({ at: 0, command: "\\UFFFFFFFF'" }).text).toBe("\\UFFFFFFFF");
  });

  it("does not close on an escaped quote, and runs to the end when it never closes", () => {
    expect(ansiCQuoted({ at: 0, command: "it\\'s' tail" })).toEqual({ end: 6, text: "it's" });
    expect(ansiCQuoted({ at: 0, command: "open" })).toEqual({ end: 4, text: "open" });
  });
});

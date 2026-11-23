/**
 * Rendering an argv as a line a reader can paste — the failure being pinned is a printed command that does
 * not parse, which a turn discovers only by running it.
 */
import { describe, expect, it } from "vitest";

import { shellCommandLine, shellQuoteToken } from "../../../lib/shellCommandLine.js";

describe("an argv printed for a human to run", () => {
  // A brief asked "What's the history?" and printed a line whose apostrophe never closes.
  it("quotes a question carrying an apostrophe, closing and reopening around it", () => {
    expect(shellCommandLine({ command: ["slopweaver", "store", "read", "What's the history?"] })).toBe(
      `slopweaver store read 'What'\\''s the history?'`,
    );
  });

  it("leaves a shell-safe token bare, so the common line stays readable", () => {
    expect(shellCommandLine({ command: ["/abs/bin/slopweaver", "store", "status", "--home", "/tmp/home-b"] })).toBe(
      "/abs/bin/slopweaver store status --home /tmp/home-b",
    );
  });

  it("quotes a token with a space, a dollar or a backtick, and an empty one", () => {
    expect(shellQuoteToken({ token: "two words" })).toBe("'two words'");
    expect(shellQuoteToken({ token: "$HOME" })).toBe("'$HOME'");
    expect(shellQuoteToken({ token: "`id`" })).toBe("'`id`'");
    expect(shellQuoteToken({ token: "" })).toBe("''");
  });

  // A home whose path holds a newline printed its command across two lines, so the pasted line
  // opened a quote it never closed.
  it("keeps a token holding a newline on one line, every control character escaped inside $'…'", () => {
    const line = shellCommandLine({ command: ["slopweaver", "--home", "/tmp/acme\nit's\thome\\\u0001"] });
    expect(line).toBe(`slopweaver --home $'/tmp/acme\\nit\\'s\\thome\\\\\\x01'`);
    expect(line.split("\n")).toEqual([line]);
  });

  // A C1 control (U+0085, next line) was printed raw inside plain single quotes.
  it("escapes a C1 control and DEL inside $'…' as their UTF-8 bytes, leaving other non-ASCII raw", () => {
    const line = shellCommandLine({ command: ["--home", "/tmp/é\u0085\u007f"] });
    expect(line).toBe(`--home $'/tmp/é\\xc2\\x85\\x7f'`);
  });

  // Unicode's LINE and PARAGRAPH SEPARATOR are line breaks a reader may split on, though not controls.
  // Built by code point, so this file carries neither character raw.
  it("escapes a LINE and a PARAGRAPH SEPARATOR inside $'…' as their UTF-8 bytes", () => {
    const home = `/tmp/a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
    const line = shellCommandLine({ command: ["--home", home] });
    expect(line).toBe(`--home $'/tmp/a\\xe2\\x80\\xa8b\\xe2\\x80\\xa9c'`);
  });

  // A bidi override (U+202E, category Cf) reorders what a reader sees, so it is escaped like a control.
  it("escapes a right-to-left override inside $'…' as its UTF-8 bytes", () => {
    const line = shellCommandLine({ command: ["acme" + String.fromCharCode(0x202e) + "evil"] });
    expect(line).toBe(`$'acme\\xe2\\x80\\xaeevil'`);
  });

  it("renders an empty argv as an empty line", () => {
    expect(shellCommandLine({ command: [] })).toBe("");
  });
});

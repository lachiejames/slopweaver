import { describe, expect, it } from "vitest";

import { osascriptLanguage, stringSpans, withoutScriptComments } from "../../../admit/scriptComments.js";

describe("withoutScriptComments — AppleScript", () => {
  it("removes line, hash and nested block comments, each to a single space", () => {
    expect(
      withoutScriptComments({
        language: "applescript",
        program: 'tell app "Finder" -- note\n# whole line\n(* outer (* inner *) outer *)activate',
      }),
    ).toBe('tell app "Finder"  \n \n activate');
  });

  it("keeps a comment marker inside a string, and reads an apostrophe as code rather than a quote", () => {
    expect(
      withoutScriptComments({
        language: "applescript",
        program: `display dialog "a -- b \\" (* c"\nset w to window 1's name -- gone`,
      }),
    ).toBe(`display dialog "a -- b \\" (* c"\nset w to window 1's name  `);
  });

  it("runs an unclosed block comment to the end of the program", () => {
    expect(withoutScriptComments({ language: "applescript", program: 'x (* tell app "Safari"' })).toBe("x  ");
  });
});

describe("withoutScriptComments — JavaScript", () => {
  it("removes line and block comments, a block comment not nesting", () => {
    expect(
      withoutScriptComments({
        language: "javascript",
        program: "a // gone\n/* x /* y */ b -- kept # kept",
      }),
    ).toBe("a  \n  b -- kept # kept");
  });

  it("keeps a regular expression literal whole, a `//` inside it no comment, and reads `/` after `)` as division", () => {
    expect([
      withoutScriptComments({ language: "javascript", program: "r = /\\//; x // gone" }),
      withoutScriptComments({ language: "javascript", program: "r = /[/]/; x" }),
      withoutScriptComments({ language: "javascript", program: "y = (a) / b // gone" }),
    ]).toEqual(["r = /\\//; x  ", "r = /[/]/; x", "y = (a) / b  "]);
  });

  it("keeps a comment marker inside any of its three string quotes", () => {
    const program = "var u = 'https://x'; var v = \"//y\"; var w = `/*z*/`;";
    expect(withoutScriptComments({ language: "javascript", program })).toBe(program);
  });
});

describe("stringSpans", () => {
  it("spans each literal from its opening quote to just past its closing one, an escaped quote inside it", () => {
    expect(stringSpans({ language: "applescript", program: `a "b\\"c" d "e"` })).toEqual([
      { end: 8, start: 2 },
      { end: 14, start: 11 },
    ]);
  });

  it("reads an apostrophe as a quote in JavaScript only", () => {
    expect([
      stringSpans({ language: "javascript", program: "x = 'y'" }),
      stringSpans({ language: "applescript", program: "window 1's name" }),
    ]).toEqual([[{ end: 7, start: 4 }], []]);
  });

  it("leaves each ${…} of a template as code and spans the text around it, and spans a plain one", () => {
    expect([
      stringSpans({ language: "javascript", program: "x = `a${b}c`" }),
      stringSpans({ language: "javascript", program: "x = `${f({ k: 1 })}`" }),
      stringSpans({ language: "javascript", program: "x = `abc`" }),
    ]).toEqual([
      [
        { end: 6, start: 4 },
        { end: 12, start: 9 },
      ],
      [
        { end: 5, start: 4 },
        { end: 20, start: 18 },
      ],
      [{ end: 9, start: 4 }],
    ]);
  });
});

describe("stringSpans — regular expressions", () => {
  it("spans a JavaScript regular expression after an operator, never a division, and none in AppleScript", () => {
    expect([
      stringSpans({ language: "javascript", program: 'p = /"x/; q' }),
      stringSpans({ language: "javascript", program: "y = (a) / b / c" }),
      stringSpans({ language: "javascript", program: "y = /unclosed\n/" }),
      stringSpans({ language: "applescript", program: "y = /x/" }),
    ]).toEqual([[{ end: 8, start: 4 }], [], [], []]);
  });
});

describe("osascriptLanguage", () => {
  it("reads -l JavaScript in any case, and AppleScript otherwise", () => {
    expect([
      osascriptLanguage({ args: ["-l", "JavaScript", "-e", "x"] }),
      osascriptLanguage({ args: ["-l", "javascript"] }),
      osascriptLanguage({ args: ["-lJavaScript", "-e", "x"] }),
      osascriptLanguage({ args: ["-l", "AppleScript", "-e", "x"] }),
      osascriptLanguage({ args: ["-e", "x"] }),
      osascriptLanguage({ args: ["-l"] }),
      osascriptLanguage({ args: [] }),
    ]).toEqual(["javascript", "javascript", "javascript", "applescript", "applescript", "applescript", "applescript"]);
  });
});

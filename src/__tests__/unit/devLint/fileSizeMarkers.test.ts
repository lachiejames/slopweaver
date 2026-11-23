import { describe, expect, it } from "vitest";
import {
  FILE_LINES_EXEMPT_MARKER,
  FILE_LINES_REGISTER_MARKER,
  fileSizeOf,
  hasExemptMarker,
  hasRetiredRegisterMarker,
  isGeneratedContent,
  leadingCommentOf,
} from "../../../devLint/fileSizeMeasure.js";

const NONE: ReadonlySet<string> = new Set();

describe("hasExemptMarker and isGeneratedContent", () => {
  it("reads the existing GENERATED marker as generated", () => {
    expect(isGeneratedContent({ content: "// GENERATED — do not hand-edit\nconst a = 1;" })).toBe(true);
  });

  it("reads a file carrying the file-lines exempt marker with a reason as declaring it", () => {
    expect(hasExemptMarker({ content: "// max-file-lines-exempt: a domain error union\nconst a = 1;" })).toBe(true);
  });

  it("does NOT read a file that only mentions the marker name, with no reason after it", () => {
    const content = "// the override markers are max-file-lines-exempt and home-safety-exempt\nconst a = 1;";
    expect(hasExemptMarker({ content })).toBe(false);
  });

  it("does NOT read a marker whose reason is blank", () => {
    expect(hasExemptMarker({ content: "// max-file-lines-exempt:   \nconst a = 1;" })).toBe(false);
  });

  it("does NOT let a block comment's own terminator stand in for the reason — the r3 counterexample", () => {
    expect(hasExemptMarker({ content: "/* max-file-lines-exempt: */\nconst a = 1;" })).toBe(false);
    expect(hasExemptMarker({ content: "/** max-file-lines-exempt: */\nconst a = 1;" })).toBe(false);
  });

  it("does NOT let a lone carriage return carry the next line's code in as the reason", () => {
    expect(hasExemptMarker({ content: "// max-file-lines-exempt:   \rconst a = 1;" })).toBe(false);
  });

  it("does NOT read a blank reason under CRLF either, where the return is the only character left", () => {
    expect(hasExemptMarker({ content: "// max-file-lines-exempt:\r\nconst a = 1;" })).toBe(false);
  });

  it("does NOT let a Unicode line separator carry the next line's code in either", () => {
    expect(hasExemptMarker({ content: "// max-file-lines-exempt:   \u{2028}const a = 1;" })).toBe(false);
    expect(hasExemptMarker({ content: "// max-file-lines-exempt:   \u{2029}const a = 1;" })).toBe(false);
  });

  it("still reads a block comment that carries a real reason before its terminator", () => {
    expect(hasExemptMarker({ content: "/* max-file-lines-exempt: a generated surface */\nconst a = 1;" })).toBe(true);
  });

  it("reads ANY marker carrying a reason, not only the first one in the file", () => {
    const content = "/* max-file-lines-exempt: */\n// max-file-lines-exempt: the register IS the length\nconst a = 1;";
    expect(hasExemptMarker({ content })).toBe(true);
  });

  it("reads nothing in ordinary content", () => {
    expect(hasExemptMarker({ content: "const a = 1;" })).toBe(false);
  });
});

describe("fileSizeOf", () => {
  it("measures a non-exempt file's raw and code lines", () => {
    const content = ["const a = 1;", "// a comment", "const b = 2;"].join("\n");
    expect(fileSizeOf({ approvedTradeoffPaths: NONE, content, path: "src/x.ts" })).toEqual({
      codeLines: 2,
      exempt: false,
      exemptMarker: false,
      path: "src/x.ts",
      rawLines: 2,
      registerMarker: false,
    });
  });

  it("MEASURES an exempt file rather than dropping it", () => {
    const content = "// GENERATED — do not hand-edit\nconst a = 1;\nconst b = 2;";
    expect(fileSizeOf({ approvedTradeoffPaths: NONE, content, path: "src/x.ts" })).toEqual({
      codeLines: 2,
      exempt: true,
      exemptMarker: false,
      path: "src/x.ts",
      rawLines: 2,
      registerMarker: false,
    });
  });
});

describe("a marker is the marker, not a longer name ending in it", () => {
  it("does not read a NEGATED register spelling as a register", () => {
    const content = "// not-max-file-lines-register: this file is not a register\nconst a = 1;";
    expect(hasRetiredRegisterMarker({ content })).toBe(false);
  });

  it("does not read a negated EXEMPT spelling as an exemption", () => {
    const content = "// not-max-file-lines-exempt: this file is not exempt\nconst a = 1;";
    expect(hasExemptMarker({ content })).toBe(false);
  });

  it("still exempts the 1,859-line GENERATED file that tried to deny being a register, and finds no register", () => {
    const content = "// GENERATED — do not hand-edit\n// not-max-file-lines-register: no\nconst a = 1;";
    const measured = fileSizeOf({ approvedTradeoffPaths: NONE, content, path: "src/atlas/slackApi/browser.ts" });
    expect(measured.exempt).toBe(true);
    expect(measured.registerMarker).toBe(false);
  });

  it("does not read a NON-ASCII hyphen negation as a register — the r2 walk past the denylist", () => {
    const content = "// not\u{2011}max-file-lines-register: this file is not a register\nconst a = 1;";
    expect(hasRetiredRegisterMarker({ content })).toBe(false);
  });

  it("does not read an em-dash or an underscore negation either, since the criterion is an allowlist", () => {
    expect(hasRetiredRegisterMarker({ content: "// not\u{2014}max-file-lines-register: no\nconst a = 1;" })).toBe(
      false,
    );
    expect(hasRetiredRegisterMarker({ content: "// not_max-file-lines-register: no\nconst a = 1;" })).toBe(false);
    expect(hasRetiredRegisterMarker({ content: "// notmax-file-lines-register: no\nconst a = 1;" })).toBe(false);
  });

  it("does not read a marker embedded in PROSE that denies it — the r3 walk past the allowlist", () => {
    const content = "// Do not add max-file-lines-register: this file is not a register\nconst a = 1;";
    expect(hasRetiredRegisterMarker({ content })).toBe(false);
  });

  it("does not read a file that merely DISCUSSES the exemption marker mid-sentence", () => {
    const content = "// The marker is max-file-lines-exempt: and it needs a reason\nconst a = 1;";
    expect(hasExemptMarker({ content })).toBe(false);
  });

  it("does not read a file whose comment DENIES being exempt — the same sentence, the exempt marker", () => {
    const content = "// Do not add max-file-lines-exempt: this file is not exempt\nconst a = 1;";
    expect(hasExemptMarker({ content })).toBe(false);
  });

  it("reads the marker when an ordinary comment prefix precedes it", () => {
    expect(hasRetiredRegisterMarker({ content: "/* max-file-lines-register: the table IS the length */" })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: " * max-file-lines-register: the table IS the length" })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: "max-file-lines-register: bare, in no comment at all" })).toBe(false);
    expect(hasRetiredRegisterMarker({ content: "//max-file-lines-register: no space after the slashes" })).toBe(true);
  });
});

describe("the marker LITERALS", () => {
  it("are the exact text a file writes, because every marker in the tree is hand-typed prose", () => {
    expect(FILE_LINES_EXEMPT_MARKER).toBe("max-file-lines-exempt");
    expect(FILE_LINES_REGISTER_MARKER).toBe("max-file-lines-register");
  });

  it("are what the readers actually match, so a rename cannot silently unmark the tree", () => {
    expect(hasExemptMarker({ content: `// ${FILE_LINES_EXEMPT_MARKER}: a domain error union` })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: `// ${FILE_LINES_REGISTER_MARKER}: the table IS the length` })).toBe(
      true,
    );
  });
});

describe("a comment OPENER, not a run of comment characters", () => {
  it("does not read a marker inside a regex literal, where one slash opens nothing", () => {
    const content = "/max-file-lines-register: reason/;\nconst a = 1;";
    expect(hasRetiredRegisterMarker({ content })).toBe(false);
    expect(hasExemptMarker({ content: "/max-file-lines-exempt: reason/;\nconst a = 1;" })).toBe(false);
  });

  it("still reads every real opener, including the continuation star and the bare first line", () => {
    expect(hasRetiredRegisterMarker({ content: "/// max-file-lines-register: a triple slash" })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: "/** max-file-lines-register: a doc block */" })).toBe(true);
    expect(hasRetiredRegisterMarker({ content: " ** max-file-lines-register: a continuation" })).toBe(true);
    expect(hasExemptMarker({ content: "// max-file-lines-exempt: the very first line of the file" })).toBe(true);
  });
});

describe("a marker is a COMMENT, and that is the whole rule", () => {
  it("does not read a bare marker line that parses as ordinary JavaScript", () => {
    const content =
      "const max = 4, file = 1, lines = 1, register = 1;\nconst value = true ?\nmax-file-lines-register: 0;\n";
    expect(hasRetiredRegisterMarker({ content })).toBe(false);
  });

  it("requires the opener even on the first line, where there is nothing above to carry it", () => {
    expect(hasExemptMarker({ content: "max-file-lines-exempt: a reason but no comment" })).toBe(false);
    expect(hasExemptMarker({ content: "// max-file-lines-exempt: a reason in a comment" })).toBe(true);
  });
});

describe("leadingCommentOf — where GENERATED is read from", () => {
  it("reads the header above the first line of code, a shebang skipped", () => {
    expect(
      leadingCommentOf({ content: "#!/usr/bin/env node\n// one\n/* two\n * three */\n\nconst x = 1;\n// after" }),
    ).toBe("#!/usr/bin/env node\n// one\n/* two\n * three */\n");
  });

  it("is empty for a file that opens on code", () => {
    expect(leadingCommentOf({ content: "export const x = 1;\n// GENERATED — do not hand-edit" })).toBe("");
  });

  it("reads a file whose header says GENERATED, and not a generator that emits the phrase further down", () => {
    expect(isGeneratedContent({ content: "// GENERATED — do not hand-edit\nexport const x = 1;\n" })).toBe(true);
    expect(isGeneratedContent({ content: "const out = `\n * GENERATED — do not hand-edit\n`;\n" })).toBe(false);
  });
});

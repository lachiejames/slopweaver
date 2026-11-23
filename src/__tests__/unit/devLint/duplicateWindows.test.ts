import { describe, expect, it } from "vitest";
import {
  codeLinesOf,
  findDuplicateFilePairs,
  importDeclarationLines,
  parseBaselineJson,
  WINDOW_SIZE,
  windowsOf,
} from "../../../devLint/duplicateWindows.js";
import { unwrapErr } from "../../../lib/result.js";

describe("codeLinesOf", () => {
  it("drops blank lines and keeps original line numbers", () => {
    const content = ["const a = 1;", "", "const b = 2;"].join("\n");
    expect(codeLinesOf({ content })).toEqual([
      { line: 1, text: "const a = 1;" },
      { line: 3, text: "const b = 2;" },
    ]);
  });

  it("drops whole-line // comments", () => {
    const content = ["// a comment", "const a = 1;"].join("\n");
    expect(codeLinesOf({ content })).toEqual([{ line: 2, text: "const a = 1;" }]);
  });

  it("drops a /* */ block comment's opening, closing and continuation lines", () => {
    const content = ["/**", " * a jsdoc line", " */", "const a = 1;"].join("\n");
    expect(codeLinesOf({ content })).toEqual([{ line: 4, text: "const a = 1;" }]);
  });

  it("trims leading and trailing whitespace so indentation depth does not matter", () => {
    const content = "    const a = 1;  ";
    expect(codeLinesOf({ content })).toEqual([{ line: 1, text: "const a = 1;" }]);
  });

  it("keeps a line that merely contains // or * mid-line", () => {
    const content = ['const url = "https://x";', "const p = a * b;"].join("\n");
    expect(codeLinesOf({ content })).toEqual([
      { line: 1, text: 'const url = "https://x";' },
      { line: 2, text: "const p = a * b;" },
    ]);
  });
});

describe("windowsOf", () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({ line: i + 1, text: `line ${String(i)}` }));
  const none: ReadonlySet<number> = new Set();

  it("produces one window per starting position that still fits", () => {
    const windows = windowsOf({ importLines: none, lines, path: "src/x.ts", size: 5 });
    expect(windows).toHaveLength(16);
    expect(windows[0]!.startLine).toBe(1);
    expect(windows[15]!.startLine).toBe(16);
  });

  it("produces no windows when the file has fewer lines than the window size", () => {
    expect(windowsOf({ importLines: none, lines: lines.slice(0, 3), path: "src/x.ts", size: 5 })).toEqual([]);
  });

  it("two identical windows in different files hash the same", () => {
    const a = windowsOf({ importLines: none, lines, path: "src/a.ts", size: 5 });
    const b = windowsOf({ importLines: none, lines, path: "src/b.ts", size: 5 });
    expect(a[0]!.hash).toBe(b[0]!.hash);
  });

  it("two different windows hash differently", () => {
    const other = lines.map((l) => ({ ...l, text: `${l.text}!` }));
    const a = windowsOf({ importLines: none, lines, path: "src/a.ts", size: 5 });
    const b = windowsOf({ importLines: none, lines: other, path: "src/b.ts", size: 5 });
    expect(a[0]!.hash).not.toBe(b[0]!.hash);
  });

  const importContent = [
    'import { unsetFieldAsNull } from "#lib/absent.js";',
    'import { err, ok, type Result } from "#lib/result.js";',
    "import {",
    "  type AtlasKindView,",
    "  channelObservations,",
    '} from "../kit/read.js";',
    'import "./sideEffect.js";',
    "const answer = 42;",
  ].join("\n");
  const importBlock = codeLinesOf({ content: importContent });
  const importLines = importDeclarationLines({ content: importContent, path: "src/a.ts" });

  it("hashes no window made only of import declaration lines", () => {
    expect(windowsOf({ importLines, lines: importBlock.slice(0, 7), path: "src/a.ts", size: 7 })).toEqual([]);
  });

  it("still hashes a window carrying one code line past the imports", () => {
    const windows = windowsOf({ importLines, lines: importBlock, path: "src/a.ts", size: 7 });
    expect(windows.map((w) => w.startLine)).toEqual([2]);
  });

  it("hashes fifteen repeated dynamic import( ) statements, which are code", () => {
    const content = Array.from({ length: 15 }, () => 'import ("node:fs");').join("\n");
    const windows = windowsOf({
      importLines: importDeclarationLines({ content, path: "src/a.ts" }),
      lines: codeLinesOf({ content }),
      path: "src/a.ts",
      size: WINDOW_SIZE,
    });
    expect(windows).toHaveLength(1);
  });
});

describe("importDeclarationLines", () => {
  it("names single-line, multi-line and side-effect imports, and nothing after them", () => {
    const content = [
      'import { a } from "a";',
      "import type {",
      "  B,",
      "  C,",
      '} from "bc";',
      'import "side";',
      "export const d = 1;",
    ].join("\n");
    expect([...importDeclarationLines({ content, path: "src/x.ts" })]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("names no dynamic import, with or without a space, nor import.meta", () => {
    const content = [
      'const m = await import("m");',
      'import ("node:fs");',
      "import(",
      '"m");',
      "const here = import.meta.url;",
    ].join("\n");
    expect([...importDeclarationLines({ content, path: "src/x.ts" })]).toEqual([]);
  });

  it("names no import-shaped line inside a template literal", () => {
    const content = ["const source = `", 'import { a } from "a";', "`;"].join("\n");
    expect([...importDeclarationLines({ content, path: "src/x.ts" })]).toEqual([]);
  });

  it("leaves out a line an import shares with another statement or a trailing comment", () => {
    const content = [
      'import { a } from "a"; doThing();',
      'import { b } from "b"; // why',
      'import data from "./d.json" with { type: "json" };',
    ].join("\n");
    expect([...importDeclarationLines({ content, path: "src/x.ts" })]).toEqual([3]);
  });
});

describe("findDuplicateFilePairs", () => {
  it("finds no pairs when every window is unique", () => {
    const windows = [
      { hash: "h1", path: "src/a.ts", startLine: 1 },
      { hash: "h2", path: "src/b.ts", startLine: 1 },
    ];
    expect(findDuplicateFilePairs({ windows })).toEqual({ filePairs: [], hitCount: 0 });
  });

  it("does not count a repeated hash within the SAME file", () => {
    const windows = [
      { hash: "h1", path: "src/a.ts", startLine: 1 },
      { hash: "h1", path: "src/a.ts", startLine: 20 },
    ];
    expect(findDuplicateFilePairs({ windows })).toEqual({ filePairs: [], hitCount: 0 });
  });

  it("pairs two files sharing one hash", () => {
    const windows = [
      { hash: "h1", path: "src/b.ts", startLine: 1 },
      { hash: "h1", path: "src/a.ts", startLine: 5 },
    ];
    expect(findDuplicateFilePairs({ windows })).toEqual({
      filePairs: [{ a: "src/a.ts", b: "src/b.ts" }],
      hitCount: 1,
    });
  });

  it("does not double-count the same file pair across multiple shared hashes", () => {
    const windows = [
      { hash: "h1", path: "src/a.ts", startLine: 1 },
      { hash: "h1", path: "src/b.ts", startLine: 1 },
      { hash: "h2", path: "src/a.ts", startLine: 20 },
      { hash: "h2", path: "src/b.ts", startLine: 20 },
    ];
    const report = findDuplicateFilePairs({ windows });
    expect(report.filePairs).toEqual([{ a: "src/a.ts", b: "src/b.ts" }]);
    expect(report.hitCount).toBe(2);
  });

  it("expands three files sharing one hash into three pairs", () => {
    const windows = [
      { hash: "h1", path: "src/a.ts", startLine: 1 },
      { hash: "h1", path: "src/b.ts", startLine: 1 },
      { hash: "h1", path: "src/c.ts", startLine: 1 },
    ];
    expect(findDuplicateFilePairs({ windows }).filePairs).toEqual([
      { a: "src/a.ts", b: "src/b.ts" },
      { a: "src/a.ts", b: "src/c.ts" },
      { a: "src/b.ts", b: "src/c.ts" },
    ]);
  });
});

describe("parseBaselineJson", () => {
  it("decodes a valid baseline", () => {
    const result = parseBaselineJson({ text: '{"filePairs": 27}' });
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ filePairs: 27 });
  });

  it("rejects invalid JSON", () => {
    const result = parseBaselineJson({ text: "not json" });
    expect(unwrapErr(result).message).toBe("clone baseline: invalid JSON");
  });

  it("rejects a missing filePairs field", () => {
    const result = parseBaselineJson({ text: "{}" });
    expect(unwrapErr(result).message).toBe("clone baseline: unexpected shape (expected { filePairs: number })");
  });
});

describe("WINDOW_SIZE", () => {
  it("is 15", () => {
    expect(WINDOW_SIZE).toBe(15);
  });
});

/**
 * The torn-tail-append gate's criterion: an append to a file, read through a filesystem binding, anywhere but the
 * one primitive. The negative cases matter as much as the positive ones — the binding is what keeps a domain
 * function taking `{ flag: "answer" }` out of it, and there is no exemption marker.
 */

import { describe, expect, it } from "vitest";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import { isScannablePath, partitionAgainstDebt, scanTornTailAppend } from "../../../devLint/tornTailAppend.js";
import { fsBindingsOf } from "../../../devLint/tornTailAppendBindings.js";
import { isShadowed } from "../../../devLint/tornTailAppendScope.js";
import { appendCallsIn } from "../../../devLint/tornTailAppendShape.js";
import { constInitializersOf, MAX_CONST_HOPS, resolvedValue } from "../../../devLint/tornTailAppendValue.js";

describe("fsBindingsOf", () => {
  it("binds imports and same-file aliases, keeping every export a name is bound to across scopes", () => {
    const content = [
      'import fs, { appendFileSync as add } from "node:fs";',
      'import * as nodeFs from "fs";',
      'import { readFileSync } from "node:path";',
      "const fsp = fs.promises;",
      "const { promises: { open } } = nodeFs;",
      "const copy = add;",
      "function inner(): void {",
      "  const add = fs.readFileSync;",
      "}",
    ].join("\n");
    withSourceFile({
      fileName: "src/example.ts",
      text: content,
      use: (sf) => {
        const { named, modules, aliases } = fsBindingsOf({ sf });
        expect([...modules].toSorted()).toEqual(["fs", "fsp", "nodeFs"]);
        expect(
          [...named].map(([local, exports]) => `${local}=${[...exports].toSorted().join("|")}`).toSorted(),
        ).toEqual(["add=appendFileSync|readFileSync", "copy=appendFileSync|readFileSync", "open=open"]);
        expect(aliases.size).toBe(4);
      },
    });
  });
});

describe("appendCallsIn", () => {
  it("returns each appending call node with its shape, in source order", () => {
    const content = 'import fs from "node:fs";\nfs.readFileSync(p);\nfs.appendFileSync(p, x);\nfs.openSync(p, "a+");\n';
    withSourceFile({
      fileName: "src/example.ts",
      text: content,
      use: (sf) => {
        expect(appendCallsIn({ sf }).map(({ call, shape }) => `${shape} ${call.getText(sf)}`)).toEqual([
          "append-call fs.appendFileSync(p, x)",
          'append-open fs.openSync(p, "a+")',
        ]);
      },
    });
  });
});

/** Whether each bare `name;` statement's identifier in a snippet is shadowed, in source order. */
function shadowedUses({ content }: { content: string }): readonly boolean[] {
  return withSourceFile({
    fileName: "src/example.ts",
    text: content,
    use: (sf) => {
      const uses: ts.Identifier[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isExpressionStatement(node) && ts.isIdentifier(node.expression)) {
          uses.push(node.expression);
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return uses.map((identifier) => isShadowed({ aliases: new Set(), identifier }));
    },
  });
}

describe("isShadowed", () => {
  it("sees a parameter, a catch binding and a loop variable, and never the file's own top level", () => {
    const content = [
      "function a(fs: number): void { fs; }",
      "try {} catch (fs) { fs; }",
      "for (const fs of []) { fs; }",
      "fs;",
    ].join("\n");
    expect(shadowedUses({ content })).toEqual([true, true, true, false]);
  });

  it("reads a switch as one scope, so a declaration in one case shadows a use in another", () => {
    const content = ["switch (0) {", "  case 0:", "    const fs = 1;", "  default:", "    fs;", "}", "fs;"].join("\n");
    expect(shadowedUses({ content })).toEqual([true, false]);
  });

  it("hoists a block's var to its whole function, but not a block's let nor an inner function's var", () => {
    const content = [
      "function a(): void { { var fs = 1; } fs; }",
      "function b(): void { { let fs = 1; } fs; }",
      "function c(): void { function d(): void { var fs = 1; } fs; }",
    ].join("\n");
    expect(shadowedUses({ content })).toEqual([true, false, false]);
  });
});

describe("resolvedValue", () => {
  it("follows a const through a spread and a member, and stops at a cycle rather than looping", () => {
    const content = [
      'const BASE = { flag: "a" } as const;',
      "const MERGED = { ...BASE };",
      "const PICK = MERGED.flag;",
      "const A = B;",
      "const B = A;",
      "PICK;",
      "A;",
    ].join("\n");
    withSourceFile({
      fileName: "src/example.ts",
      text: content,
      use: (sf) => {
        const scope = { consts: constInitializersOf({ sf }), hops: MAX_CONST_HOPS };
        const [pick, cycle] = sf.statements
          .slice(5)
          .map((statement) => (statement as ts.ExpressionStatement).expression);
        expect(resolvedValue({ node: pick!, scope }).getText(sf)).toBe('"a"');
        expect(resolvedValue({ node: cycle!, scope }).getText(sf)).toBe("A");
      },
    });
  });
});

/** Scan a snippet as an ordinary source file and answer `line shape` per hit. */
function hits({ content }: { content: string }): readonly string[] {
  return scanTornTailAppend({ content, path: "src/example.ts" }).map((hit) => `${String(hit.line)} ${hit.shape}`);
}

describe("scanTornTailAppend", () => {
  it("flags a named appendFileSync, the shape 72 of the 88 appends on main were written in", () => {
    expect(hits({ content: 'import { appendFileSync } from "node:fs";\nappendFileSync(p, line);\n' })).toEqual([
      "2 append-call",
    ]);
  });

  it("flags it through an alias, a namespace, a default import and the promises member", () => {
    const content = [
      'import { appendFileSync as add } from "node:fs";',
      'import * as fs from "fs";',
      'import fsDefault from "node:fs";',
      'import { promises as fsp } from "node:fs";',
      'import { appendFile } from "node:fs/promises";',
      "add(p, line);",
      "fs.appendFileSync(p, line);",
      "fsDefault.promises.appendFile(p, line);",
      "await fsp.appendFile(p, line);",
      "await appendFile(p, line);",
    ].join("\n");
    expect(hits({ content })).toEqual([
      "6 append-call",
      "7 append-call",
      "8 append-call",
      "9 append-call",
      "10 append-call",
    ]);
  });

  it("flags a member read by literal key, through parentheses and a comma, and through .call and .apply", () => {
    const content = [
      'import * as fs from "node:fs";',
      'fs["appendFileSync"](p, line);',
      "(0, fs.appendFileSync)(p, line);",
      "(fs.appendFileSync as typeof fs.appendFileSync)(p, line);",
      'fs.openSync.call(null, p, "a");',
      'fs.openSync.apply(null, [p, "a+"]);',
      'fs["promises"].appendFile(p, line);',
      'fs.openSync.call(null, p, "r");',
    ].join("\n");
    expect(hits({ content })).toEqual([
      "2 append-call",
      "3 append-call",
      "4 append-call",
      "5 append-open",
      "6 append-open",
      "7 append-call",
    ]);
  });

  it("flags an fs function or module reached through a same-file alias or destructure", () => {
    const content = [
      'import fs, { promises } from "node:fs";',
      "const append = fs.appendFileSync;",
      "const { openSync: open, promises: fsp } = fs;",
      "const io = promises;",
      "append(p, line);",
      'open(p, "a");',
      "await fsp.appendFile(p, line);",
      "await io.appendFile(p, line);",
    ].join("\n");
    expect(hits({ content })).toEqual(["5 append-call", "6 append-open", "7 append-call", "8 append-call"]);
  });

  it("flags a named import copied into a same-file alias, and through a second copy", () => {
    const content = [
      'import { appendFileSync } from "node:fs";',
      "const add = appendFileSync;",
      "const again = add;",
      'add("journal.jsonl", "row\\n");',
      'again("journal.jsonl", "row\\n");',
    ].join("\n");
    expect(hits({ content })).toEqual(["4 append-call", "5 append-call"]);
  });

  it("flags every Node append flag string, and no invalid flag that merely starts with a", () => {
    const content = [
      'import { openSync, writeFileSync } from "node:fs";',
      'openSync(p, "ax+");',
      'writeFileSync(p, text, { flag: "as+" });',
      'writeFileSync(p, text, { flag: "answer" });',
      'openSync(p, "abc");',
    ].join("\n");
    expect(hits({ content })).toEqual(["2 append-open", "3 append-flag-write"]);
  });

  it("flags an fs function reached through a nested destructure of the promises member", () => {
    const content = [
      'import fs from "node:fs";',
      "const { promises: { appendFile } } = fs;",
      'await appendFile(p, "row\\n");',
    ].join("\n");
    expect(hits({ content })).toEqual(["3 append-call"]);
  });

  it("flags the default import spelt as a named one", () => {
    const content = [
      'import { default as fs } from "node:fs";',
      'fs.writeFileSync("journal.jsonl", "record\\n", { flag: "a" });',
    ].join("\n");
    expect(hits({ content })).toEqual(["2 append-flag-write"]);
  });

  it("flags a let alias the file never reassigns, and drops one it does", () => {
    const content = [
      'import fs from "node:fs";',
      "let kept = fs.appendFileSync;",
      "let swapped = fs.appendFileSync;",
      "let { appendFileSync: moved } = fs;",
      "swapped = () => {};",
      "moved = () => {};",
      "kept(p, line);",
      "swapped(p, line);",
      "moved(p, line);",
    ].join("\n");
    expect(hits({ content })).toEqual(["7 append-call"]);
  });

  it("flags a write whose options spell flag as a quoted key, and O_APPEND read by literal key", () => {
    const content = [
      'import { constants, openSync, writeFileSync } from "node:fs";',
      'writeFileSync(p, text, { "flag": "a" });',
      'openSync(p, constants["O_APPEND"] | constants.O_WRONLY);',
    ].join("\n");
    expect(hits({ content })).toEqual(["2 append-flag-write", "3 append-open"]);
  });

  it("leaves a name an inner scope redeclares alone, and still flags an alias declared inside a function", () => {
    const content = [
      'import fs, { appendFileSync } from "node:fs";',
      "function logs(): void {",
      "  const appendFileSync = (value: string): void => console.log(value);",
      '  appendFileSync("not a path");',
      "}",
      "function takes(fs: { openSync: (v: string, mode: string) => void }): void {",
      '  fs.openSync("a seat", "a");',
      "}",
      "function writes(): void {",
      "  const add = fs.appendFileSync;",
      "  add(p, line);",
      "  appendFileSync(p, line);",
      "}",
    ].join("\n");
    expect(hits({ content })).toEqual(["11 append-call", "12 append-call"]);
  });

  it("follows options and flags held in same-file consts, spreads and members of a const object", () => {
    const content = [
      'import { constants, openSync, writeFileSync } from "node:fs";',
      'const APPEND_OPTIONS = { flag: "a" } as const;',
      "const MERGED = { encoding: 'utf8', ...APPEND_OPTIONS };",
      'const MODES = { append: "a+", read: "r" };',
      "const PARTS = constants.O_WRONLY;",
      "const RAW = PARTS | constants.O_APPEND;",
      'const flag = "as";',
      'writeFileSync(p, "row\\n", APPEND_OPTIONS);',
      'writeFileSync(p, "row\\n", MERGED);',
      'writeFileSync(p, "row\\n", { flag });',
      "openSync(p, MODES.append);",
      "openSync(p, RAW | constants.O_CREAT);",
      "openSync(p, MODES.read);",
      'writeFileSync(p, "row\\n", { ...APPEND_OPTIONS, flag: "w" });',
    ].join("\n");
    expect(hits({ content })).toEqual([
      "8 append-flag-write",
      "9 append-flag-write",
      "10 append-flag-write",
      "11 append-open",
      "12 append-open",
    ]);
  });

  it("resolves a const options name in the scope of its use, never by whichever same-named const comes last", () => {
    const content = [
      'import { constants, openSync, writeFileSync } from "node:fs";',
      'const OPTIONS = { flag: "a" } as const;',
      'writeFileSync(p, "row\\n", OPTIONS);',
      "function unrelated(): void {",
      '  const OPTIONS = { flag: "w" } as const;',
      '  writeFileSync(p, "row\\n", OPTIONS);',
      "}",
      "function inner(): void {",
      '  const LOCAL = { flag: "a" } as const;',
      '  writeFileSync(p, "row\\n", LOCAL);',
      "}",
      "function param(OPTIONS: { flag: string }): void {",
      '  writeFileSync(p, "row\\n", OPTIONS);',
      "}",
      "const FLAGS = constants.O_APPEND;",
      "openSync(p, FLAGS);",
      "{",
      "  const FLAGS = constants.O_RDONLY;",
      "  openSync(p, FLAGS);",
      "}",
    ].join("\n");
    expect(hits({ content })).toEqual(["3 append-flag-write", "10 append-flag-write", "16 append-open"]);
  });

  it("keeps every fs export a name is bound to across scopes, so an inner alias cannot hide an imported append", () => {
    const content = [
      'import * as fs from "node:fs";',
      'import { appendFileSync as add } from "node:fs";',
      "function inspect(): void {",
      "  const add = fs.readFileSync;",
      "  void add;",
      "}",
      'add("journal.jsonl", "row\\n");',
    ].join("\n");
    expect(hits({ content })).toEqual(["7 append-call"]);
  });

  it("follows flags and options a const object destructure binds, by the member it reads", () => {
    const content = [
      'import { constants, openSync, writeFileSync } from "node:fs";',
      "const { O_APPEND: APPEND, O_WRONLY } = constants;",
      'const { append, read } = { append: { flag: "a" }, read: { flag: "r" } };',
      "const { ...ALL } = constants;",
      "openSync(p, APPEND | constants.O_WRONLY);",
      "openSync(p, O_WRONLY);",
      'writeFileSync(p, "row\\n", append);',
      'writeFileSync(p, "row\\n", read);',
      "openSync(p, ALL.O_APPEND);",
      'const { flag, ...options } = { flag: "a", encoding: "utf8" } as const;',
      'writeFileSync(p, "row\\n", options);',
    ].join("\n");
    expect(hits({ content })).toEqual(["5 append-open", "7 append-flag-write", "9 append-open"]);
  });

  it("drops a let destructure whose nested name the file reassigns", () => {
    const content = [
      'import * as fs from "node:fs";',
      "let { promises: { appendFile: add } } = fs;",
      "add = (async () => {}) as typeof add;",
      'void add("/tmp/not-written", "data");',
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("reads the rest element of a module destructure as the module", () => {
    const content = [
      'import * as fs from "node:fs";',
      "const { readFileSync, ...io } = fs;",
      'const fd = io.openSync("journal.jsonl", "a");',
      "readFileSync(p);",
    ].join("\n");
    expect(hits({ content })).toEqual(["3 append-open"]);
  });

  it("flags an open for append by string flag, by O_APPEND, and by a const holding O_APPEND", () => {
    const content = [
      'import { constants, openSync } from "node:fs";',
      "const APPEND = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT;",
      'openSync(p, "a");',
      'openSync(p, "a+", 0o600);',
      "openSync(p, constants.O_RDWR | constants.O_APPEND);",
      "openSync(p, APPEND, 0o600);",
    ].join("\n");
    expect(hits({ content })).toEqual(["3 append-open", "4 append-open", "5 append-open", "6 append-open"]);
  });

  it("flags a write or stream opened with an append flag option", () => {
    const content = [
      'import { createWriteStream, writeFileSync } from "node:fs";',
      'writeFileSync(p, text, { flag: "a" });',
      'createWriteStream(p, { flags: "a" });',
    ].join("\n");
    expect(hits({ content })).toEqual(["2 append-flag-write", "3 append-flag-write"]);
  });

  it("flags an appendFile method on any receiver, which is how a promises FileHandle appends", () => {
    expect(hits({ content: "await handle.appendFile(line);\n" })).toEqual(["1 append-method"]);
  });

  it("leaves an open for reading, writing or replacing alone", () => {
    const content = [
      'import { constants, openSync, writeFileSync } from "node:fs";',
      'openSync(p, "r");',
      'openSync(p, "w", 0o600);',
      "openSync(p, constants.O_RDONLY);",
      'writeFileSync(p, text, { flag: "wx" });',
      'writeFileSync(p, text, "utf8");',
    ].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("leaves a domain function that happens to take an `a…` flag alone, because it is not the filesystem", () => {
    const content = ['import { recordText } from "./record.js";', 'recordText({ flag: "answer", text });'].join("\n");
    expect(hits({ content })).toEqual([]);
  });

  it("leaves a call through the shared primitive alone", () => {
    const content = 'import { appendLines } from "#lib/appendSeparator.js";\nappendLines({ path, text });\n';
    expect(hits({ content })).toEqual([]);
  });

  it("exempts the primitive itself, the one module every append is routed through", () => {
    const content = 'import { appendFileSync } from "node:fs";\nappendFileSync(p, line);\n';
    expect(scanTornTailAppend({ content, path: "src/lib/appendSeparator.ts" })).toEqual([]);
  });
});

describe("partitionAgainstDebt", () => {
  const recorded = [{ count: 2, guard: "its own tail read", path: "src/a.ts", shape: "append-open" as const }];
  const hit = { excerpt: "openSync(p, APPEND)", line: 1, path: "src/a.ts", shape: "append-open" as const };

  it("passes an append the debt records at its recorded count", () => {
    expect(partitionAgainstDebt({ debt: recorded, hits: [hit, { ...hit, line: 9 }] })).toEqual({
      fresh: [],
      stale: [],
    });
  });

  it("refuses a third append beside two recorded ones, and an unrecorded file, as fresh", () => {
    const third = { ...hit, line: 20 };
    const elsewhere = { ...hit, path: "src/b.ts" };
    const verdict = partitionAgainstDebt({ debt: recorded, hits: [hit, { ...hit, line: 9 }, third, elsewhere] });
    expect(verdict.fresh.map((h) => `${h.path}:${String(h.line)}`)).toEqual([
      "src/a.ts:1",
      "src/a.ts:9",
      "src/a.ts:20",
      "src/b.ts:1",
    ]);
    expect(verdict.stale).toEqual([]);
  });

  it("refuses an entry that fires fewer times than it records as stale, so the list only shrinks", () => {
    expect(partitionAgainstDebt({ debt: recorded, hits: [hit] })).toEqual({
      fresh: [],
      stale: ["src/a.ts (append-open): records 2, fires 1"],
    });
  });
});

describe("isScannablePath", () => {
  it("covers the source trees and skips tests, which seed torn tails on purpose", () => {
    expect(isScannablePath({ path: "src/live/turn/loopBreakage.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/__tests__/unit/live/turn/loopBreakage.test.ts" })).toBe(false);
  });

  it("skips the gate's own files, whose text spells the shapes it names", () => {
    expect(isScannablePath({ path: "src/devLint/tornTailAppend.ts" })).toBe(false);
  });
});

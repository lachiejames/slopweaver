/*
 * The layering that makes the corpus reader's order a structure rather than a convention.
 *
 * While the reader was one 556-line file, "a row is decoded before it is tallied, and a file is streamed
 * before it is grouped" was a rule a reader had to keep in their head. It is an import graph now: the row
 * grammar and the JSONL reader import nothing of the family, the tally imports only the row grammar, and
 * the directory read is the one module that composes all three.
 *
 * These cases read the source text because that is where the property lives. Every one opens on an input
 * proven non-empty, so a file that stopped existing reddens instead of passing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readCorpusDir } from "../../../corpus/corpusDirRead.js";
import { resolveCorpusScan } from "../../../corpus/corpusResolve.js";
import { parseRow } from "../../../corpus/corpusRowCore.js";
import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { countRows } from "../../../corpus/corpusTallyCore.js";

/** Every module of the family, in the layer order the split intends. */
const FAMILY = [
  "corpusRowCore.ts",
  "corpusStore.ts",
  "corpusTallyCore.ts",
  "corpusResolve.ts",
  "corpusDirRead.ts",
] as const;

function sourceOf({ module }: { module: string }): string {
  return readFileSync(new URL(`../../../corpus/${module}`, import.meta.url), "utf8");
}

function importedSpecifiers({ module }: { module: string }): readonly string[] {
  return [...sourceOf({ module }).matchAll(/from "([^"]+)";$/gm)].map((match) => match[1]!);
}

function familyImportsOf({ module }: { module: string }): readonly string[] {
  return importedSpecifiers({ module })
    .filter((specifier) => /^\.\/corpus(RowCore|Store|TallyCore|DirRead|Resolve)\.js$/.test(specifier))
    .toSorted();
}

describe("the family these cases read", () => {
  it("finds all five modules, each with a real import block, so no case below is vacuous", () => {
    const counts = FAMILY.map((module) => importedSpecifiers({ module }).length);
    expect(counts.length).toBe(5);
    expect(counts.filter((count) => count === 0)).toEqual([]);
  });

  it("binds each layer's entry point by name, so a rename reddens here rather than silently", () => {
    const bound = [parseRow, readJsonlLines, countRows, resolveCorpusScan, readCorpusDir];
    expect(bound.map((fn) => fn.name)).toEqual([
      "parseRow",
      "readJsonlLines",
      "countRows",
      "resolveCorpusScan",
      "readCorpusDir",
    ]);
    expect(bound.map((fn) => fn.length)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("the import graph runs one way", () => {
  it("leaves the row grammar and the JSONL reader standing on nothing of the family", () => {
    expect(familyImportsOf({ module: "corpusRowCore.ts" })).toEqual([]);
    expect(familyImportsOf({ module: "corpusStore.ts" })).toEqual([]);
  });

  it("points the tally at the row grammar alone, and the resolver at the reader alone", () => {
    expect(familyImportsOf({ module: "corpusTallyCore.ts" })).toEqual(["./corpusRowCore.js"]);
    expect(familyImportsOf({ module: "corpusResolve.ts" })).toEqual(["./corpusStore.js"]);
  });

  it("leaves the directory read composing the three below it, and nothing importing it back", () => {
    expect(familyImportsOf({ module: "corpusDirRead.ts" })).toEqual([
      "./corpusRowCore.js",
      "./corpusStore.js",
      "./corpusTallyCore.js",
    ]);
    const importingTop = FAMILY.filter((module) => importedSpecifiers({ module }).includes("./corpusDirRead.js"));
    expect(importingTop).toEqual([]);
  });
});

describe("the layer each thing belongs to", () => {
  it("keeps the streaming reader in corpusStore.ts, which is the file AGENTS.md names for it", () => {
    const declaring = FAMILY.filter((module) => sourceOf({ module }).includes("export function readJsonlLines("));
    expect(declaring).toEqual(["corpusStore.ts"]);
  });

  it("keeps the between-chunk heap guard with the directory read and out of the reader", () => {
    expect(sourceOf({ module: "corpusDirRead.ts" })).toContain("heapGuard = guardHeap");
    expect(sourceOf({ module: "corpusStore.ts" })).not.toContain("guardHeap");
  });

  it("leaves no silent fallback in the two declarations that moved one", () => {
    expect(sourceOf({ module: "corpusTallyCore.ts" })).toContain("seen === undefined ? 1 : seen + 1");
    expect(sourceOf({ module: "corpusResolve.ts" })).toContain("corpusRootFor({ corpus, home })");
  });
});

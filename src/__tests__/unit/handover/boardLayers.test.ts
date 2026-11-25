/*
 * The layering that makes the board's precedence a structure rather than a convention.
 *
 * While the composer was one 555-line file, "a row's own evidence is decided before its dependencies are,
 * and a refusal reads a finished model rather than recomputing one" was a rule a reader had to keep in
 * their head across thirty declarations. It is an import graph now: the vocabulary imports nothing of the
 * family, the rules, the dependency pass and the refusals each import only the vocabulary, and the composer
 * is the one module that reaches across two of them.
 *
 * These cases read the source text because that is where the property lives. Every one opens on an input
 * proven non-empty, so a file that stopped existing reddens instead of passing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveDependencyPending } from "../../../handover/boardDependencies.js";
import { ownEvidence } from "../../../handover/boardEvidence.js";
import { executionRefusal } from "../../../handover/boardRefusal.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import { runDisposition } from "../../../handover/boardTypes.js";

/** Every module of the family, in the layer order the split intends. */
const FAMILY = [
  "boardTypes.ts",
  "boardEvidence.ts",
  "boardDependencies.ts",
  "boardRefusal.ts",
  "boardState.ts",
] as const;

function sourceOf({ module }: { module: string }): string {
  return readFileSync(new URL(`../../../handover/${module}`, import.meta.url), "utf8");
}

function importedSpecifiers({ module }: { module: string }): readonly string[] {
  return [...sourceOf({ module }).matchAll(/from "([^"]+)";$/gm)].map((match) => match[1]!);
}

function familyImportsOf({ module }: { module: string }): readonly string[] {
  return importedSpecifiers({ module })
    .filter((specifier) => /^\.\/board(Types|Evidence|Dependencies|Refusal|State)\.js$/.test(specifier))
    .toSorted();
}

describe("the family these cases read", () => {
  it("finds all five modules, each with a real import block, so no case below is vacuous", () => {
    expect(FAMILY.length).toBe(5);
    expect(FAMILY.filter((module) => sourceOf({ module }).length > 0)).toEqual([...FAMILY]);
    expect(FAMILY.filter((module) => importedSpecifiers({ module }).length > 0)).toEqual([...FAMILY]);
  });

  it("binds each layer's public entry point by name, so a rename reddens here rather than silently", () => {
    const bound = [runDisposition, ownEvidence, resolveDependencyPending, executionRefusal, composeBoardModels];
    expect(bound.map((fn) => fn.name)).toEqual([
      "runDisposition",
      "ownEvidence",
      "resolveDependencyPending",
      "executionRefusal",
      "composeBoardModels",
    ]);
    expect(bound.map((fn) => fn.length)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("the import graph is one way", () => {
  it("gives the vocabulary no dependency on the family at all", () => {
    expect(familyImportsOf({ module: "boardTypes.ts" })).toEqual([]);
  });

  it("lets the rules, the dependency pass and the refusals see the vocabulary and nothing else", () => {
    expect(familyImportsOf({ module: "boardEvidence.ts" })).toEqual(["./boardTypes.js"]);
    expect(familyImportsOf({ module: "boardDependencies.ts" })).toEqual(["./boardTypes.js"]);
    expect(familyImportsOf({ module: "boardRefusal.ts" })).toEqual(["./boardTypes.js"]);
  });

  it("makes the composer the only module reaching across two layers", () => {
    expect(familyImportsOf({ module: "boardState.ts" })).toEqual([
      "./boardDependencies.js",
      "./boardEvidence.js",
      "./boardTypes.js",
    ]);
  });

  it("keeps the rules from seeing a dependency closure, which is what makes the two passes independent", () => {
    expect(sourceOf({ module: "boardEvidence.ts" })).not.toContain("dependencyClosures");
    expect(sourceOf({ module: "boardDependencies.ts" })).toContain("dependencyClosures");
  });
});

describe("the four fallbacks the split had to rewrite", () => {
  it("reads a settled ask's witness and reason as destructured defaults", () => {
    const text = sourceOf({ module: "boardEvidence.ts" });
    expect(text).toContain(
      'const { settlementReason = "no reason recorded", settlementWitness: witness = "no witness" }',
    );
  });

  it("reads an authored terminal's summary as a destructured default", () => {
    expect(sourceOf({ module: "boardEvidence.ts" })).toContain(
      "const { statusSummary = `declared ${derived.status}` }",
    );
  });

  it("falls from the in-flight rules to the remaining ones through an if that returns", () => {
    const text = sourceOf({ module: "boardEvidence.ts" });
    expect(text).toContain("const inFlight = inFlightEvidence({ derived, probe, run });");
    expect(text).toContain("return remainingEvidence({ derived, events, run });");
  });

  it("leaves no silent fallback anywhere in the rule family", () => {
    expect(sourceOf({ module: "boardEvidence.ts" })).not.toContain("??");
  });
});

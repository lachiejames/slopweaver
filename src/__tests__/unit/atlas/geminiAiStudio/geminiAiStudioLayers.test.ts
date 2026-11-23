/*
 * The gemini-ai-studio sync family is a one-way import graph, asserted by name.
 *
 * `sync.ts` was one 554-line file holding the vocabulary, the coverage cells, the gaps, the kind files and
 * the read-check-write shell. Nothing stopped any of those five reaching any other, so the property this
 * file guards is the one the split exists to create rather than a restatement of the code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { previousCell } from "../../../../atlas/geminiAiStudio/geminiAiStudioCells.js";
import { syncManifest } from "../../../../atlas/geminiAiStudio/geminiAiStudioFiles.js";
import { censusDrift, crossKindGaps, operationGaps } from "../../../../atlas/geminiAiStudio/geminiAiStudioGaps.js";
import { dispositionCounts } from "../../../../atlas/geminiAiStudio/geminiAiStudioSurfaces.js";
import { GEMINI_AI_STUDIO_KINDS, type GeminiAiStudioKind } from "../../../../atlas/geminiAiStudio/model.js";
import { syncGeminiAiStudioCompiledSurface } from "../../../../atlas/geminiAiStudio/sync.js";

const FAMILY = [
  "geminiAiStudioSurfaces.ts",
  "geminiAiStudioCells.ts",
  "geminiAiStudioGaps.ts",
  "geminiAiStudioFiles.ts",
  "sync.ts",
] as const;

function sourceOf({ module }: { module: string }): string {
  return readFileSync(new URL(`../../../../atlas/geminiAiStudio/${module}`, import.meta.url), "utf8");
}

/** Every `./geminiAiStudio*.js` or `./sync.js` specifier one module imports from. */
function familyImportsOf({ module }: { module: string }): readonly string[] {
  const found: string[] = [];
  for (const match of sourceOf({ module }).matchAll(/from "\.\/([A-Za-z]+)\.js"/g)) {
    const file = `${match[1]!}.ts`;
    if (FAMILY.includes(file as (typeof FAMILY)[number])) {
      found.push(file);
    }
  }
  return found.toSorted();
}

describe("the gemini-ai-studio sync family", () => {
  it("has a source file for every member it declares", () => {
    expect(FAMILY.length).toBe(5);
    expect(FAMILY.map((module) => sourceOf({ module }).length > 0)).toEqual([true, true, true, true, true]);
  });

  it("binds each layer's exported entry point", () => {
    expect([dispositionCounts.name, previousCell.name, censusDrift.name, operationGaps.name]).toEqual([
      "dispositionCounts",
      "previousCell",
      "censusDrift",
      "operationGaps",
    ]);
    expect([crossKindGaps.length, syncGeminiAiStudioCompiledSurface.length]).toEqual([1, 1]);
  });

  it("gives the vocabulary no edge into its own family", () => {
    expect(familyImportsOf({ module: "geminiAiStudioSurfaces.ts" })).toEqual([]);
  });

  it("lets the cells and the gaps reach the vocabulary and nothing else", () => {
    expect(familyImportsOf({ module: "geminiAiStudioCells.ts" })).toEqual(["geminiAiStudioSurfaces.ts"]);
    expect(familyImportsOf({ module: "geminiAiStudioGaps.ts" })).toEqual(["geminiAiStudioSurfaces.ts"]);
  });

  it("lets only the kind files reach both L1 layers", () => {
    expect(familyImportsOf({ module: "geminiAiStudioFiles.ts" })).toEqual([
      "geminiAiStudioCells.ts",
      "geminiAiStudioGaps.ts",
      "geminiAiStudioSurfaces.ts",
    ]);
  });

  it("leaves the shell importing the layers below it and never a cell", () => {
    expect(familyImportsOf({ module: "sync.ts" })).toEqual([
      "geminiAiStudioFiles.ts",
      "geminiAiStudioGaps.ts",
      "geminiAiStudioSurfaces.ts",
    ]);
  });

  it("keeps the cells and the gaps genuinely unaware of each other", () => {
    expect(sourceOf({ module: "geminiAiStudioCells.ts" })).not.toContain("operationGaps");
    expect(sourceOf({ module: "geminiAiStudioGaps.ts" })).toContain("operationGaps");
    expect(sourceOf({ module: "geminiAiStudioGaps.ts" })).not.toContain("compiledCell");
    expect(sourceOf({ module: "geminiAiStudioCells.ts" })).toContain("compiledCell");
  });

  it("carries the three named replacements for the fallbacks that moved", () => {
    expect(sourceOf({ module: "geminiAiStudioFiles.ts" })).toContain("function storedKindFile({");
    expect(sourceOf({ module: "geminiAiStudioFiles.ts" })).toContain("function operationsOfKind({");
    expect(sourceOf({ module: "geminiAiStudioFiles.ts" })).toContain("function manifestBase({");
  });

  it("returns null rather than defaulting past a surface never published", () => {
    expect(previousCell({ coverage: [], matches: () => true })).toBe(null);
  });

  it("stamps a fresh manifest when the atlas has never been published", () => {
    // Spelled out rather than folded from GEMINI_AI_STUDIO_KINDS, so a kind added to the atlas reddens this
    // line instead of being silently counted at zero.
    const counts = {
      auth_tokens: 0,
      batches: 0,
      cachedContents: 0,
      corpora: 0,
      dynamic: 0,
      environments: 0,
      fileSearchStores: 0,
      files: 0,
      generatedFiles: 0,
      media: 0,
      models: 0,
      operations: 0,
      page: 0,
      tunedModels: 0,
    } satisfies Record<GeminiAiStudioKind, number>;
    const stamped = syncManifest({ at: "2026-09-21T00:00:00.000Z", counts, manifest: null });
    expect(stamped.updatedAt).toBe("2026-09-21T00:00:00.000Z");
    expect(Object.keys(stamped.kinds).toSorted()).toEqual([...GEMINI_AI_STUDIO_KINDS].toSorted());
    expect(stamped.kinds.models.lastSuccessAt).toBe("2026-09-21T00:00:00.000Z");
  });
});

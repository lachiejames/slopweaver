/*
 * The witness for the shape of the Slack evidence split, read off the source rather than believed.
 *
 * The five modules form a line, not a web: types is the leaf nothing else in the family is allowed to reach
 * back through, both legs stand on the record reader, and the merge stands on neither leg. That property is
 * what lets `slackEvidence.ts` say what a disagreement between the corpus and the live search means without
 * either leg importing the other, and it is invisible to every other test in this tree — a cycle or a
 * backward edge would still compile and every behaviour test would still pass.
 *
 * Every negative here is paired with a positive control asserting the same reader DOES see a specifier it is
 * supposed to, so a regex that silently stopped matching reddens instead of reporting every module clean.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** Every module specifier a module imports from, in source order. */
function importedSpecifiers({ module }: { module: string }): readonly string[] {
  const source = readFileSync(new URL(`../../../review/${module}`, import.meta.url), "utf8");
  return [...source.matchAll(/^import[^;]*?from "([^"]+)";$/gm)].map((match) => match[1]!);
}

/** The siblings of one module within the Slack evidence family. */
function familyImportsOf({ module }: { module: string }): readonly string[] {
  return importedSpecifiers({ module }).filter((specifier) => specifier.startsWith("./slackEvidence"));
}

const FAMILY = [
  "slackEvidence.ts",
  "slackEvidenceTypes.ts",
  "slackEvidenceRecord.ts",
  "slackEvidenceScan.ts",
  "slackEvidenceLive.ts",
];

describe("the Slack evidence family reads its own source", () => {
  it("finds imports in every module, so a negative below cannot be vacuous", () => {
    const counts = FAMILY.map((module) => importedSpecifiers({ module }).length);
    expect(counts.filter((count) => count === 0)).toEqual([]);
    expect(counts.length).toBe(5);
  });
});

describe("slackEvidenceTypes.ts is the leaf", () => {
  it("imports no other module of the family", () => {
    expect(familyImportsOf({ module: "slackEvidenceTypes.ts" })).toEqual([]);
  });

  it("still imports the three modules outside the family it names types from", () => {
    expect(importedSpecifiers({ module: "slackEvidenceTypes.ts" })).toEqual([
      "../corpus/slack/ownerBot.js",
      "./evidence.js",
      "./prLink.js",
    ]);
  });
});

describe("slackEvidenceRecord.ts stands on the leaf and nothing else", () => {
  it("imports only slackEvidenceTypes.js from the family", () => {
    expect(familyImportsOf({ module: "slackEvidenceRecord.ts" })).toEqual(["./slackEvidenceTypes.js"]);
  });
});

describe("both legs stand on the record reader, and neither on the other", () => {
  it("the corpus leg imports the record reader and the leaf", () => {
    expect(familyImportsOf({ module: "slackEvidenceScan.ts" })).toEqual([
      "./slackEvidenceRecord.js",
      "./slackEvidenceTypes.js",
    ]);
  });

  it("the live leg imports the record reader and the leaf", () => {
    expect(familyImportsOf({ module: "slackEvidenceLive.ts" })).toEqual([
      "./slackEvidenceRecord.js",
      "./slackEvidenceTypes.js",
    ]);
  });
});

describe("the merge stands on neither leg", () => {
  it("imports only the leaf", () => {
    expect(familyImportsOf({ module: "slackEvidence.ts" })).toEqual(["./slackEvidenceTypes.js"]);
  });
});

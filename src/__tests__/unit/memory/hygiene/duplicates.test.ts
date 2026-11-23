/**
 * CHECK 3 — the near-duplicate scan, at its measured threshold.
 *
 * Two properties carry the weight, and each has a control that fails a naive implementation:
 *
 *  - **the body is never read.** Two memories with unrelated descriptions but an identical quoted paragraph are
 *    NOT a pair — a scan that folded bodies in would manufacture one out of correct cross-referencing.
 *  - **the shared vocabulary is RARE.** Every leaf here carries the words a real corpus shares (`owner`,
 *    `session`, `slopweaver`); a plain-Jaccard implementation pairs all of them and fails.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { buildMemoryCorpus } from "../../../../memory/corpus.js";
import {
  DUPLICATE_JACCARD,
  DUPLICATE_MAX_FREQUENCY,
  duplicateMaxFrequency,
  findDuplicatePairs,
} from "../../../../memory/hygiene/duplicates.js";
import type { MemoryLeaf, MemorySourceFile } from "../../../../memory/types.js";

/** One leaf file, with its description and body under this test's control. */
function leaf({ stem, description, body }: { stem: string; description: string; body: string }): MemorySourceFile {
  return {
    file: `${stem}.md`,
    text: `---\nname: ${stem}\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`,
  };
}

/** The leaves of a corpus built from these files, through the real parser. */
function leavesOf({ files }: { files: readonly MemorySourceFile[] }): readonly MemoryLeaf[] {
  return buildMemoryCorpus({
    files: [
      { file: "MEMORY.md", text: `# Index\n\n${files.map((f) => `- [X](${f.file}) — a fact`).join("\n")}\n` },
      ...files,
    ],
  }).leaves;
}

describe("findDuplicatePairs", () => {
  it("pairs two memories whose distinctive vocabulary is nearly the same", () => {
    const files = [
      leaf({
        body: "Prefer the pelican migration ordering.",
        description: "pelican migration ordering is chronological for the owner session",
        stem: "pelican-migration-ordering",
      }),
      leaf({
        body: "Prefer the pelican migration ordering.",
        description: "pelican migration ordering stays chronological in an owner session",
        stem: "pelican-migration-chronological",
      }),
      leaf({
        body: "Quokka batching is fine.",
        description: "quokka batching tolerates an owner session interrupt",
        stem: "quokka-batching-tolerance",
      }),
    ];
    const pairs = findDuplicatePairs({ leaves: leavesOf({ files }) });
    expect(pairs.length).toBe(1);
    expect(pairs[0]!.files).toEqual(["pelican-migration-chronological.md", "pelican-migration-ordering.md"]);
    expect(pairs[0]!.similarity).toBeGreaterThan(DUPLICATE_JACCARD);
    expect(pairs[0]!.sharedTokens).toEqual(["chronological", "migration", "ordering", "pelican"]);
  });

  it("does NOT pair two memories that share only a body", () => {
    const shared =
      'The owner said "the ordering is chronological and the batching tolerates an interrupt" on the call.';
    const files = [
      leaf({ body: shared, description: "pelican migration ordering", stem: "pelican-migration-ordering" }),
      leaf({ body: shared, description: "quokka batching tolerance", stem: "quokka-batching-tolerance" }),
    ];
    expect(findDuplicatePairs({ leaves: leavesOf({ files }) })).toEqual([]);
  });

  it("does NOT pair memories whose only overlap is vocabulary the whole corpus shares", () => {
    const files = Array.from({ length: 6 }, (_unused, position) =>
      leaf({
        body: "A fact.",
        description: `the owner session slopweaver handover thing number ${String(position)}`,
        stem: `common-vocabulary-${String(position)}`,
      }),
    );
    expect(findDuplicatePairs({ leaves: leavesOf({ files }) })).toEqual([]);
  });

  it("returns nothing for an empty corpus and for a single memory", () => {
    expect(findDuplicatePairs({ leaves: [] })).toEqual([]);
    const one = leavesOf({ files: [leaf({ body: "A fact.", description: "a lone pelican fact", stem: "lone" })] });
    expect(findDuplicatePairs({ leaves: one })).toEqual([]);
  });

  it("orders pairs by similarity descending, then by filename", () => {
    // Each invented token is at least five characters and appears in at most two of the three memories, so
    // none is ruled out by the corpus ceiling and the post-ceiling sets are known exactly: {alphax, bravox},
    // {alphax, charliex}, {charliex, deltax}. `note` is in all three and is therefore too common.
    const files = [
      leaf({ body: "x", description: "alphax bravox", stem: "l1-note" }),
      leaf({ body: "x", description: "alphax charliex", stem: "l2-note" }),
      leaf({ body: "x", description: "charliex deltax", stem: "l3-note" }),
    ];
    const pairs = findDuplicatePairs({ leaves: leavesOf({ files }), threshold: 0 });
    // Two pairs at one shared token over three, one pair sharing nothing — and the tie is broken by filename.
    expect(pairs.map((pair) => [pair.files[0], pair.files[1], pair.similarity])).toEqual([
      ["l1-note.md", "l2-note.md", 0.33],
      ["l2-note.md", "l3-note.md", 0.33],
      ["l1-note.md", "l3-note.md", 0],
    ]);
  });

  it("takes a threshold, so the measured default is a value rather than a hidden rule", () => {
    const files = [
      leaf({ body: "x", description: "pelican migration ordering", stem: "pelican-ordering" }),
      leaf({ body: "x", description: "quokka batching tolerance", stem: "quokka-tolerance" }),
    ];
    const leaves = leavesOf({ files });
    expect(findDuplicatePairs({ leaves })).toEqual([]);
    expect(findDuplicatePairs({ leaves, threshold: 0 }).length).toBe(1);
  });
});

describe("duplicateMaxFrequency", () => {
  it("raises the ceiling on a small corpus so two memories are never 'too common'", () => {
    // The measurement this function exists for: `indexSources` rules out a token appearing in MORE than
    // `frequency * count` sources, so that product has to reach two — a token in exactly two memories is the
    // duplicate signal itself, and a flat quarter puts the product at 0.75 over a corpus of three.
    expect(duplicateMaxFrequency({ count: 3 }) * 3).toBeCloseTo(2, 10);
    expect(duplicateMaxFrequency({ count: 4 })).toBe(0.5);
    expect(DUPLICATE_MAX_FREQUENCY * 3).toBe(0.75);
  });

  it("settles on the measured share once the corpus is large enough to carry it", () => {
    expect(duplicateMaxFrequency({ count: 8 })).toBe(DUPLICATE_MAX_FREQUENCY);
    expect(duplicateMaxFrequency({ count: 100 })).toBe(DUPLICATE_MAX_FREQUENCY);
  });

  it("answers the bare share for an empty corpus rather than dividing by zero", () => {
    expect(duplicateMaxFrequency({ count: 0 })).toBe(DUPLICATE_MAX_FREQUENCY);
  });
});

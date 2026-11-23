/**
 * CHECK 2 — `MEMORY.md` against the loader's own read limit.
 *
 * The property that earns this check its place is `pointersBelowCut`: not the byte count, but WHICH memories the
 * loader never reaches. So every over-budget case asserts the named targets, because an implementation that
 * reported the truncation and lost the list would pass a count-only test while being useless.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { buildMemoryCorpus } from "../../../../memory/corpus.js";
import { INDEX_BYTE_LIMIT, INDEX_LINE_LIMIT, measureIndexBudget } from "../../../../memory/hygiene/indexBudget.js";
import type { MemoryIndex } from "../../../../memory/types.js";

/** An index of `count` pointers, each naming its own leaf, so every pointer is individually identifiable. */
function indexOf({ count }: { count: number }): string {
  const rows = Array.from(
    { length: count },
    (_unused, position) => `- [Row ${String(position)}](row-${String(position)}.md) — a fact`,
  );
  return `# Index\n\n${rows.join("\n")}\n`;
}

/** The parsed index for a given text — the real parser, because pointer LINE numbers are what the cut reads. */
function parsedIndex({ text }: { text: string }): MemoryIndex | null {
  return buildMemoryCorpus({ files: [{ file: "MEMORY.md", text }] }).root;
}

describe("measureIndexBudget", () => {
  it("reports an index that fits, with no cut and no unreachable pointers", () => {
    const text = indexOf({ count: 5 });
    const budget = measureIndexBudget({ index: parsedIndex({ text }), text });
    expect(budget.lines).toBe(7);
    expect(budget.cutAtLine).toBe(null);
    expect(budget.limitReached).toBe(null);
    expect(budget.pointersBelowCut).toEqual([]);
    expect(budget.nearLimit).toBe(false);
  });

  it("does not count a file's trailing newline as a line of content", () => {
    const budget = measureIndexBudget({ index: null, text: "one\ntwo\n" });
    expect(budget.lines).toBe(2);
    expect(budget.bytes).toBe(8);
  });

  it("names the LINE limit and every pointer past it", () => {
    // A heading and its blank line plus 200 rows is 202 lines, so the cut at 200 strands the last two rows.
    const text = indexOf({ count: INDEX_LINE_LIMIT });
    const budget = measureIndexBudget({ index: parsedIndex({ text }), text });
    expect(budget.lines).toBe(INDEX_LINE_LIMIT + 2);
    expect(budget.limitReached).toBe("lines");
    expect(budget.cutAtLine).toBe(INDEX_LINE_LIMIT);
    // `MemoryPointer.target` strips `.md` from a same-directory pointer, so these are stems.
    expect(budget.pointersBelowCut).toEqual(["row-198", "row-199"]);
    expect(budget.nearLimit).toBe(false);
  });

  it("names the BYTE limit when it bites before the line limit", () => {
    const rows = Array.from(
      { length: 20 },
      (_unused, position) => `- [Fat](fat-${String(position)}.md) — ${"x".repeat(2_000)}`,
    );
    const text = `# Index\n\n${rows.join("\n")}\n- [Last](last.md) — a fact\n`;
    const budget = measureIndexBudget({ index: parsedIndex({ text }), text });
    expect(budget.limitReached).toBe("bytes");
    expect(budget.bytes).toBeGreaterThan(INDEX_BYTE_LIMIT);
    expect(budget.cutAtLine).toBe(14);
    // Lines 1-2 are the heading and its blank, so a cut at 14 strands the last eight fat rows plus `last`.
    expect(budget.pointersBelowCut).toEqual([
      "fat-12",
      "fat-13",
      "fat-14",
      "fat-15",
      "fat-16",
      "fat-17",
      "fat-18",
      "fat-19",
      "last",
    ]);
  });

  it("flags an index within a tenth of the line limit that still fits", () => {
    const text = indexOf({ count: 185 });
    const budget = measureIndexBudget({ index: parsedIndex({ text }), text });
    expect(budget.lines).toBe(187);
    expect(budget.cutAtLine).toBe(null);
    expect(budget.nearLimit).toBe(true);
  });

  it("measures an empty index without inventing a cut", () => {
    const budget = measureIndexBudget({ index: null, text: "" });
    // No content at all is zero LINES, not one empty one — splitting an empty string yields no line of text.
    expect(budget.lines).toBe(0);
    expect(budget.bytes).toBe(0);
    expect(budget.cutAtLine).toBe(null);
    expect(budget.nearLimit).toBe(false);
  });

  it("reports the truncation even with no parsed index to name pointers from", () => {
    const text = indexOf({ count: INDEX_LINE_LIMIT });
    const budget = measureIndexBudget({ index: null, text });
    expect(budget.limitReached).toBe("lines");
    expect(budget.pointersBelowCut).toEqual([]);
  });
});

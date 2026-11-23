// deleted-with-code: modalValue
import { describe, expect, it } from "vitest";

import { linesFromPages, linesFromRuns, type PolicyTextRun } from "../../../policy/render/textRuns.js";

/** One glyph-bearing run, with only the fields a test cares about spelled out. */
function run(over: Partial<PolicyTextRun> = {}): PolicyTextRun {
  return { endsLine: false, fontName: "f1", height: 9.6, text: "word", width: 20, x: 76.8, y: 600, ...over };
}

describe("linesFromRuns", () => {
  it("ends a line where the page's own layout ended it", () => {
    const lines = linesFromRuns({
      page: 1,
      runs: [run({ text: "one " }), run({ endsLine: true, text: "two" }), run({ endsLine: true, text: "three" })],
    });
    expect(lines.length).toBe(2);
    expect(lines[0]!.text).toBe("one two");
    expect(lines[1]!.text).toBe("three");
  });

  it("takes the TALLEST glyph on a line as its height, not the first", () => {
    const lines = linesFromRuns({
      page: 1,
      runs: [run({ height: 9.6, text: "a " }), run({ endsLine: true, height: 16.8, text: "b" })],
    });
    expect(lines[0]!.height).toBe(16.8);
  });

  it("takes the SMALLEST left edge on a line as its x, because a hanging indent puts it second", () => {
    const lines = linesFromRuns({
      page: 1,
      runs: [run({ text: "a ", x: 120 }), run({ endsLine: true, text: "b", x: 76.8 })],
    });
    expect(lines[0]!.x).toBe(76.8);
  });

  it("measures the whitespace between runs, never the distance between their left edges", () => {
    const lines = linesFromRuns({
      page: 1,
      runs: [run({ text: "cell one", width: 40, x: 100 }), run({ endsLine: true, text: "cell two", x: 300 })],
    });
    expect(lines[0]!.runGaps).toStrictEqual([160]);
  });

  it("drops a line whose runs carry no glyphs at all", () => {
    const lines = linesFromRuns({ page: 1, runs: [run({ endsLine: true, height: 0, text: "" })] });
    expect(lines.length).toBe(0);
  });

  it("drops a line that is only whitespace", () => {
    expect(linesFromRuns({ page: 1, runs: [run({ endsLine: true, text: "   " })] }).length).toBe(0);
  });

  it("flushes a trailing line the layout never ended", () => {
    const lines = linesFromRuns({ page: 3, runs: [run({ text: "last line" })] });
    expect(lines.length).toBe(1);
    expect(lines[0]!.page).toBe(3);
  });
});

describe("linesFromPages", () => {
  it("keeps each line's own page while flattening the document", () => {
    const lines = linesFromPages({
      pages: [
        { page: 1, runs: [run({ endsLine: true, text: "first" })] },
        { page: 2, runs: [run({ endsLine: true, text: "second" })] },
      ],
    });
    expect(lines.map((line) => line.page)).toStrictEqual([1, 2]);
  });

  it("returns nothing for a document with no pages", () => {
    expect(linesFromPages({ pages: [] }).length).toBe(0);
  });
});

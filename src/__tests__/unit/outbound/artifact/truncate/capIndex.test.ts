/*
 * `capIndex`: index lines past the count cap or the above-the-fold width cap are dropped, counting the lead and
 * the exact warning width. It moved here when `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { buildIndexTruncationLine, capIndex } from "../../../../../outbound/artifact/truncate.js";
import { text } from "./harness.js";

describe("capIndex", () => {
  it("is a no-op when the index already fits both the count and the width cap", () => {
    const index = [[text({ value: "one" })], [text({ value: "two" })]];
    const result = capIndex({ citations: [], index, leadLength: 0, maxAboveFold: 100, maxItems: 5 });

    expect(result.linesDropped).toBe(0);
    expect(result.index).toEqual(index);
  });

  it("drops trailing lines past the count cap, reserving one slot for the warning line", () => {
    const index = [[text({ value: "a" })], [text({ value: "b" })], [text({ value: "c" })]];
    const result = capIndex({ citations: [], index, leadLength: 0, maxAboveFold: 1000, maxItems: 2 });

    expect(result.linesDropped).toBe(2);
    expect(result.index.length).toBe(1);
  });

  it("drops trailing lines past the above-the-fold width cap, counting leadLength AND the exact warning width", () => {
    const index = [[text({ value: "x".repeat(200) })], [text({ value: "y".repeat(200) })]];
    const result = capIndex({ citations: [], index, leadLength: 100, maxAboveFold: 400, maxItems: 5 });

    expect(result.linesDropped).toBe(1);
    expect(result.index.length).toBe(1);
  });

  it("can drop every line when even room for the warning cannot be found", () => {
    const index = [[text({ value: "x".repeat(20) })]];
    const result = capIndex({ citations: [], index, leadLength: 10, maxAboveFold: 25, maxItems: 5 });

    expect(result.linesDropped).toBe(1);
    expect(result.index.length).toBe(0);
  });

  it("never leaves an output whose region, INCLUDING the appended warning, exceeds maxAboveFold — the appended-warning counterexample", () => {
    // Six lines at [108,108,107,107,1,1], tldr 180, maxAboveFold 650, maxItems 5: a fixed 40-char reserve
    // let the appended "+2 more..." (49 chars) push the real total to 659. The exact-fit check must not.
    const index = [
      [text({ value: "x".repeat(108) })],
      [text({ value: "x".repeat(108) })],
      [text({ value: "x".repeat(107) })],
      [text({ value: "x".repeat(107) })],
      [text({ value: "x" })],
      [text({ value: "x" })],
    ];
    const result = capIndex({ citations: [], index, leadLength: 180, maxAboveFold: 650, maxItems: 5 });
    const finalIndex =
      result.linesDropped > 0
        ? [...result.index, buildIndexTruncationLine({ linesDropped: result.linesDropped })]
        : result.index;
    const finalWidth =
      180 +
      finalIndex.reduce(
        (total, line) => total + line.reduce((sum, run) => sum + (run.type === "text" ? run.text.length : 0), 0),
        0,
      );

    expect(finalIndex.length).toBeLessThanOrEqual(5);
    expect(finalWidth).toBeLessThanOrEqual(650);
  });
});

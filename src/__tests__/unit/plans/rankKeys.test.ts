/**
 * The lexicographic mechanic both providers' routers rank on.
 *
 * Its own file because the discipline is the thing under test, not either provider's policy: the keys a
 * Claude or Codex ranking builds are asserted in their own lanes, and what is held down here is that a
 * tuple decides in ORDER, a tie falls through to the next element, and a stable sort preserves the pool's
 * incoming order as the final word. All three are properties the two routers rely on and neither states.
 */
import { describe, expect, it } from "vitest";

import { compareKeys, rankBy } from "../../../plans/rankKeys.js";

describe("comparing two sort keys", () => {
  it("decides on the first element that differs, ignoring every later one", () => {
    // The second element says the opposite; it is never consulted, which is what "lexicographic" means.
    expect(compareKeys({ left: [1, 99], right: [2, 0] })).toBeLessThan(0);
  });

  it("falls through a tie to the next element", () => {
    expect(compareKeys({ left: [5, 1], right: [5, 2] })).toBeLessThan(0);
    expect(compareKeys({ left: [5, 2], right: [5, 1] })).toBeGreaterThan(0);
  });

  it("answers zero when every element matches, which is what lets a stable sort keep the pool's order", () => {
    expect(compareKeys({ left: [3, "a", 7], right: [3, "a", 7] })).toBe(0);
  });

  it("orders numbers numerically, not as text", () => {
    // As strings "10" < "9". A key built from percentages would rank a 10% plan behind a 9% one.
    expect(compareKeys({ left: [10], right: [9] })).toBeGreaterThan(0);
  });

  it("orders strings lexically when both elements are strings", () => {
    expect(compareKeys({ left: ["alpha"], right: ["beta"] })).toBe(-1);
    expect(compareKeys({ left: ["beta"], right: ["alpha"] })).toBe(1);
  });

  it("skips an element either side left undefined rather than ordering on its absence", () => {
    expect(compareKeys({ left: [undefined as unknown as number, 2], right: [1, 9] })).toBeLessThan(0);
  });
});

describe("ranking a pool by a key", () => {
  it("puts the lowest key first", () => {
    const ranked = rankBy({ key: (n: number) => [n], pool: [30, 4, 17] });

    expect(ranked).toEqual([4, 17, 30]);
  });

  it("keeps the pool's own order between subjects whose keys tie", () => {
    // The sort is stable, which is what lets a register's row order be the deterministic last word without
    // either router threading an explicit index through its key.
    const ranked = rankBy({
      key: ({ score }: { name: string; score: number }) => [score],
      pool: [
        { name: "second", score: 1 },
        { name: "first", score: 1 },
        { name: "third", score: 0 },
      ],
    });

    expect(ranked.map((entry) => entry.name)).toEqual(["third", "second", "first"]);
  });

  it("leaves the caller's array untouched", () => {
    const pool = [3, 1, 2];

    rankBy({ key: (n: number) => [n], pool });

    expect(pool).toEqual([3, 1, 2]);
  });
});

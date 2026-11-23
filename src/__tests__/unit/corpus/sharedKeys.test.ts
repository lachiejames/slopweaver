import { describe, expect, it } from "vitest";

import { sharedKeys } from "../../../corpus/sharedKeys.js";

describe("sharedKeys", () => {
  it("reports only keys a second DISTINCT value arrives under, values in first-seen order", () => {
    const shared = sharedKeys({
      pairs: [
        ["a", "x"],
        ["b", "y"],
        ["a", "x"],
        ["c", "z"],
        ["a", "w"],
        ["c", "z"],
        ["a", "v"],
      ],
    });
    expect(shared.keys).toBe(3);
    expect(shared.shared.map(([key, values]) => [key, [...values]])).toEqual([["a", ["x", "w", "v"]]]);
  });

  it("answers nothing for no pairs", () => {
    expect(sharedKeys({ pairs: [] })).toEqual({ keys: 0, shared: [] });
  });
});

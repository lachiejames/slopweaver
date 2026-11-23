import { describe, expect, it } from "vitest";

import { batched } from "../../../../store/publishedPages/importRows.js";

describe("batched", () => {
  it("splits a list into batches of the size given, the last one short", () => {
    expect([...batched({ rows: [1, 2, 3, 4, 5], size: 2 })]).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("yields one batch when the list fits", () => {
    expect([...batched({ rows: ["a", "b"], size: 500 })]).toEqual([["a", "b"]]);
  });

  it("yields nothing for an empty list", () => {
    expect([...batched({ rows: [], size: 500 })]).toEqual([]);
  });
});

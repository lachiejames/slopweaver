/**
 * `sameEntryNumbers` is a SET comparison: order and repetition are ignored, membership is not. The cases pin
 * both halves, so a future "tidy-up" into an element-wise or multiset compare reddens here.
 */
import { describe, expect, it } from "vitest";

import { sameEntryNumbers } from "../../../../../cli/commands/github/stackEntrySet.js";

describe("sameEntryNumbers", () => {
  it("treats the same numbers in a different order as the same entries", () => {
    expect(sameEntryNumbers({ a: [3, 1, 2], b: [1, 2, 3] })).toBe(true);
  });

  it("ignores a repeated number, because the contract is set membership rather than a multiset", () => {
    expect(sameEntryNumbers({ a: [1, 1, 2], b: [2, 1] })).toBe(true);
  });

  it("treats two empty lists as the same entries", () => {
    expect(sameEntryNumbers({ a: [], b: [] })).toBe(true);
  });

  it("refuses a list missing one of the other's numbers", () => {
    expect(sameEntryNumbers({ a: [1, 2], b: [1, 2, 3] })).toBe(false);
  });

  it("refuses a list carrying an extra number the other does not", () => {
    expect(sameEntryNumbers({ a: [1, 2, 4], b: [1, 2] })).toBe(false);
  });

  it("refuses two lists of equal size whose members differ", () => {
    expect(sameEntryNumbers({ a: [1, 2], b: [1, 3] })).toBe(false);
  });
});

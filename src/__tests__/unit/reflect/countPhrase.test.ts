import { describe, expect, it } from "vitest";

import { agreeing, countOf } from "../../../reflect/countPhrase.js";

describe("countOf", () => {
  it("takes the singular for exactly one", () => {
    expect(countOf({ count: 1, many: "pull requests", one: "pull request" })).toBe("1 pull request");
  });

  it("takes the plural for many", () => {
    expect(countOf({ count: 141, many: "pull requests", one: "pull request" })).toBe("141 pull requests");
  });

  it("takes the plural for zero", () => {
    expect(countOf({ count: 0, many: "runs", one: "run" })).toBe("0 runs");
  });
});

describe("agreeing", () => {
  it("picks the singular verb for one and the plural for two", () => {
    expect([1, 2].map((count) => agreeing({ count, many: "were", one: "was" }))).toEqual(["was", "were"]);
  });
});

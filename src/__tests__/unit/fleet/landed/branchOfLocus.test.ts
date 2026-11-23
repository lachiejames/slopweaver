/*
 * `branchOfLocus` — reading the head branch out of a PR-ledger locus, and nothing out of one without the range. It
 * moved here when `fleet landed`'s pure-join tests were split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { branchOfLocus } from "../../../../fleet/landed.js";

describe("branchOfLocus", () => {
  it("reads the head branch of owner/repo#base...head", () => {
    expect(branchOfLocus({ locus: "lachiejames/slopweaver#main...what-landed" })).toBe("what-landed");
  });

  it("names nothing for a locus without the range", () => {
    expect(branchOfLocus({ locus: "lachiejames/slopweaver#main" })).toBe(undefined);
    expect(branchOfLocus({ locus: "lachiejames/slopweaver#main..." })).toBe(undefined);
  });
});

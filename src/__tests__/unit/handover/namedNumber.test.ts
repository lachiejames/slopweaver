import { describe, expect, it } from "vitest";

import { NAMED_NUMBER } from "../../../handover/namedNumber.js";

/** Every whole match the pattern finds in `text`. */
const named = ({ text }: { text: string }): readonly string[] => [...text.matchAll(NAMED_NUMBER)].map((m) => m[0]);

describe("NAMED_NUMBER", () => {
  it("names a pull request by `#`, `PR`, `PR #` and `pull request`, across a line break", () => {
    expect(named({ text: "#1085, PR 1085, PR #1085 and pull\nrequest 1085" })).toEqual([
      "#1085",
      "PR 1085",
      "PR #1085",
      "pull\nrequest 1085",
    ]);
  });

  it("refuses a list position, a fragment, a path and an HTML entity", () => {
    expect(named({ text: "option #1, PR3, page#12, a/#12 and &#39;" })).toEqual([]);
  });
});

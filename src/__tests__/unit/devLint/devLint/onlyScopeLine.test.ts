import { describe, expect, it } from "vitest";
import { onlyScopeLine } from "../../../../devLint/lintVerdict.js";

describe("onlyScopeLine", () => {
  it("says how much of the bar a narrow run was, so a partial PASS is never read as the whole one", () => {
    expect(onlyScopeLine({ ran: ["jsdoc-tags"], total: 46 })).toBe(
      "dev lint: --only ran 1 of 46 gates, NOT the whole bar: jsdoc-tags",
    );
  });

  it("names every gate a multi-gate selection ran", () => {
    expect(onlyScopeLine({ ran: ["jsdoc-tags", "redos-check"], total: 46 })).toBe(
      "dev lint: --only ran 2 of 46 gates, NOT the whole bar: jsdoc-tags, redos-check",
    );
  });
});

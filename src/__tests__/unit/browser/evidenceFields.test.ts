/**
 * The evidence snippet's field readers: each trusts one field or names where it sat, and `problemsOf`
 * reports every failed field, one line each, in the order the fields were read.
 */
import { describe, expect, it } from "vitest";
import { numberAt, problemsOf, visibilityAt } from "../../../browser/evidenceFields.js";
import { unwrap } from "../../../lib/result.js";

describe("numberAt", () => {
  it("returns a finite number", () => {
    expect(unwrap(numberAt({ at: "before", key: "x", record: { x: 4 } }))).toBe(4);
  });

  it("names the field when it is not a finite number", () => {
    const read = numberAt({ at: "before", key: "x", record: { x: Number.NaN } });
    expect(problemsOf({ fields: [read] })).toEqual(["before.x is not a finite number"]);
  });
});

describe("visibilityAt", () => {
  it("returns a visibility word", () => {
    expect(unwrap(visibilityAt({ at: "after", key: "chart", record: { chart: "clipped" } }))).toBe("clipped");
  });

  it("names the word that was there when it is not a visibility", () => {
    const read = visibilityAt({ at: "after", key: "chart", record: { chart: "hidden" } });
    expect(problemsOf({ fields: [read] })).toEqual(["after.chart is 'hidden', not a visibility"]);
  });
});

describe("problemsOf", () => {
  it("reports every failed field in order and skips the ones that parsed", () => {
    const record = { chart: "hidden", x: "4", y: 2 };
    expect(
      problemsOf({
        fields: [
          numberAt({ at: "b", key: "x", record }),
          numberAt({ at: "b", key: "y", record }),
          visibilityAt({ at: "b", key: "chart", record }),
        ],
      }),
    ).toEqual(["b.x is not a finite number", "b.chart is 'hidden', not a visibility"]);
  });

  it("is empty when every field parsed", () => {
    expect(problemsOf({ fields: [numberAt({ at: "b", key: "y", record: { y: 2 } })] })).toEqual([]);
  });
});

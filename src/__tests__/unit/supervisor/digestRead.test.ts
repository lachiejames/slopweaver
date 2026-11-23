/**
 * The digest's document accessors: a drifted field is named rather than printed as `undefined`, and a list
 * past its cap says how many it cut.
 */
import { describe, expect, it } from "vitest";

import { asText, capped, cappedInline, countText, jsonOf, named, shortened } from "../../../supervisor/digestRead.js";

describe("digestRead", () => {
  it("names an absent or mistyped field instead of printing undefined", () => {
    expect(named({ key: "why", value: { why: "hot" } })).toBe("hot");
    expect(named({ key: "why", value: { why: 3 } })).toBe("(no why)");
    expect(named({ key: "why", value: "not a record" })).toBe("(no why)");
    expect(countText({ key: "kept", value: { kept: 0 } })).toBe("0");
    expect(countText({ key: "kept", value: {} })).toBe("?");
  });

  it("prints a list element as text: a string verbatim, anything else as its JSON", () => {
    expect(asText({ value: "r9" })).toBe("r9");
    expect(asText({ value: { id: "r8" } })).toBe('{"id":"r8"}');
    expect(asText({ value: undefined })).toBe("(nothing)");
    const deep: unknown = JSON.parse(`${"[".repeat(20_000)}0${"]".repeat(20_000)}`);
    expect(asText({ value: deep })).toBe("(unprintable)");
    expect(asText({ value: Symbol("drift") })).toBe("(unprintable)");
    expect(asText({ value: { toJSON: () => undefined } })).toBe("(unprintable)");
  });

  it("cuts an element's text, so one element cannot carry an unbounded list into a line", () => {
    const zeros = Array.from({ length: 10_000 }, () => 0);

    expect(asText({ value: zeros })).toBe(`${JSON.stringify(zeros).slice(0, 100)}…`);
    expect(asText({ value: "y".repeat(150) })).toBe(`${"y".repeat(100)}…`);
  });

  it("keeps a list at its cap and counts the rest", () => {
    const lines = Array.from({ length: 9 }, (_, index) => `x${String(index)}`);

    expect(capped({ lines: lines.slice(0, 8), prefix: "x" })).toEqual(lines.slice(0, 8));
    expect(capped({ lines, prefix: "x" })).toEqual([...lines.slice(0, 8), "x: and 1 more"]);
    expect(cappedInline({ items: lines.slice(0, 2) })).toBe("x0, x1");
    expect(cappedInline({ items: lines })).toBe("x0, x1, x2, x3, x4, x5, x6, x7 and 1 more");
  });

  it("marks a cut text with an ellipsis and leaves a short one whole", () => {
    expect(shortened({ limit: 3, text: "abcd" })).toBe("abc…");
    expect(shortened({ limit: 4, text: "abcd" })).toBe("abcd");
  });

  it("says why a reading has no JSON to read", () => {
    expect(
      jsonOf({
        inputs: {
          openPagesAgeMinutes: undefined,
          priorHolds: { kind: "none" },
          readings: new Map(),
          recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
          runAgeMinutes: undefined,
        },
        name: "depth",
      }),
    ).toEqual({
      line: "depth: not captured this tick",
    });
    expect(
      jsonOf({
        inputs: {
          openPagesAgeMinutes: undefined,
          priorHolds: { kind: "none" },
          readings: new Map([["depth", { kind: "text", text: "x" }]]),
          recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
          runAgeMinutes: undefined,
        },
        name: "depth",
      }),
    ).toEqual({ line: "depth: captured as text, not JSON" });
  });
});

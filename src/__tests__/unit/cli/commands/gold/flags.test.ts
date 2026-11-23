import { describe, expect, it } from "vitest";

import { boolFlag, textFlag, textFlagOr } from "../../../../../cli/commands/gold/flags.js";

describe("textFlag", () => {
  it("returns the string held under the named flag, not a sibling's", () => {
    expect(
      textFlag({ name: "target", values: { before: "decoy-before", target: "target-alpha", after: "decoy-after" } }),
    ).toBe("target-alpha");
  });

  it("returns an empty string as supplied rather than as absent", () => {
    expect(textFlag({ name: "target", values: { target: "" } })).toBe("");
  });

  it("returns undefined when the named flag holds a boolean", () => {
    expect(
      textFlag({ name: "target", values: { before: "decoy-before", target: true, after: "decoy-after" } }),
    ).toBeUndefined();
  });

  it("returns undefined when the named flag is absent even though siblings are strings", () => {
    expect(textFlag({ name: "target", values: { before: "decoy-before", after: "decoy-after" } })).toBeUndefined();
  });
});

describe("boolFlag", () => {
  it("is false for a false target beside a true sibling", () => {
    expect(boolFlag({ name: "target", values: { before: "decoy-before", sibling: true, target: false } })).toBe(false);
  });

  it("is true for a true target beside a false sibling", () => {
    expect(boolFlag({ name: "target", values: { before: "decoy-before", sibling: false, target: true } })).toBe(true);
  });

  it("is false when the flag holds a string rather than the boolean true", () => {
    expect(boolFlag({ name: "target", values: { before: true, target: "true" } })).toBe(false);
  });

  it("is false when the flag is absent and a sibling is true", () => {
    expect(boolFlag({ name: "target", values: { before: "decoy-before", sibling: true } })).toBe(false);
  });
});

describe("textFlagOr", () => {
  it("returns the supplied string rather than the fallback", () => {
    expect(
      textFlagOr({
        fallback: "fallback-delta",
        name: "target",
        values: { before: "decoy-before", target: "target-alpha", after: "decoy-after" },
      }),
    ).toBe("target-alpha");
  });

  it("returns the fallback when the flag is absent and a later sibling is a string", () => {
    expect(
      textFlagOr({
        fallback: "fallback-delta",
        name: "target",
        values: { before: true, after: "decoy-after" },
      }),
    ).toBe("fallback-delta");
  });

  // A truthiness test would swap an empty string for the fallback; presence, not content, decides.
  it("returns an empty supplied string rather than the fallback", () => {
    expect(textFlagOr({ fallback: "fallback-foxtrot", name: "target", values: { target: "" } })).toBe("");
  });

  it("returns the fallback when the flag holds a boolean", () => {
    expect(
      textFlagOr({
        fallback: "fallback-echo",
        name: "target",
        values: { before: "decoy-before", target: true },
      }),
    ).toBe("fallback-echo");
  });
});

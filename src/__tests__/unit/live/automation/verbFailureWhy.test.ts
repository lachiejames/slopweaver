import { describe, expect, it } from "vitest";

import { appendVerbFailureWhy, verbFailureWhy } from "../../../../live/automation/verbFailureWhy.js";

describe("verbFailureWhy", () => {
  it("keeps the LAST three non-blank lines, oldest first, joined with a slash", () => {
    const text = "step one\nstep two\n\nstep three\nstore rehearse: downloading the dump failed: socket hang up\n";
    expect(verbFailureWhy({ text })).toBe(
      "step two / step three / store rehearse: downloading the dump failed: socket hang up",
    );
  });

  it("keeps every line when the verb wrote fewer than three", () => {
    expect(verbFailureWhy({ text: "store rehearse: no backup in the bucket\n" })).toBe(
      "store rehearse: no backup in the bucket",
    );
  });

  it("strips terminal colour codes and carriage returns", () => {
    expect(verbFailureWhy({ text: "\u001b[31mstore rehearse: refused\u001b[0m\r\n" })).toBe("store rehearse: refused");
  });

  it("cuts one runaway line at 240 characters so it cannot crowd out the rest", () => {
    const why = verbFailureWhy({ text: `${"x".repeat(500)}\nthe reason\n` })!;
    expect(why).toBe(`${"x".repeat(239)}… / the reason`);
  });

  it("never splits a character outside the BMP at the cut", () => {
    const why = verbFailureWhy({ text: `${"x".repeat(238)}😀${"y".repeat(200)}\n` })!;
    expect(why).toBe(`${"x".repeat(238)}😀…`);
  });

  it("answers null when the verb wrote nothing but whitespace", () => {
    expect(verbFailureWhy({ text: "\n  \n\t\n" })).toBeNull();
  });

  it("answers null when the verb wrote nothing at all", () => {
    expect(verbFailureWhy({ text: "" })).toBeNull();
  });
});

describe("appendVerbFailureWhy", () => {
  it("appends the stderr tail to the line after a why marker", () => {
    expect(
      appendVerbFailureWhy({ diagnostics: "slack post: channel_not_found\n", line: "recipe r · ran · exit 1" }),
    ).toBe("recipe r · ran · exit 1 · why: slack post: channel_not_found");
  });

  it("leaves the line as it was when the leg wrote nothing worth keeping", () => {
    expect(appendVerbFailureWhy({ diagnostics: " \n", line: "recipe r · ran · exit 1" })).toBe(
      "recipe r · ran · exit 1",
    );
  });
});

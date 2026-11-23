import { describe, expect, it } from "vitest";

import { lfLineEndings } from "../../../../outbound/github/lineEndings.js";

describe("lfLineEndings", () => {
  it("reads every CRLF pair as one LF", () => {
    expect(lfLineEndings({ text: "## Explainer\r\nOne line.\r\n\r\n## Checks\r\n" })).toBe(
      "## Explainer\nOne line.\n\n## Checks\n",
    );
  });

  it("leaves an LF body exactly as it was", () => {
    expect(lfLineEndings({ text: "a\nb\n" })).toBe("a\nb\n");
  });

  it("leaves a lone CR alone, because GitHub's editor only ever writes the pair", () => {
    expect(lfLineEndings({ text: "a\rb\r\n" })).toBe("a\rb\n");
  });

  it("answers an empty body with an empty body", () => {
    expect(lfLineEndings({ text: "" })).toBe("");
  });
});

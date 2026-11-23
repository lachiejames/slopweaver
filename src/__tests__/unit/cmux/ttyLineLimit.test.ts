import { describe, expect, it } from "vitest";

import { TTY_LINE_LIMIT_BYTES, ttyLineOverflow } from "../../../cmux/ttyLineLimit.js";

describe("ttyLineOverflow", () => {
  it("passes a line of exactly the limit, which the terminal keeps whole with its newline", () => {
    expect(ttyLineOverflow({ line: "x".repeat(TTY_LINE_LIMIT_BYTES) })).toBe(null);
  });

  // The measured failure: a 1,100-byte boot line arrived as 1,024 bytes and the shell sat at `quote>`.
  it("refuses a line one byte over, naming both sizes", () => {
    expect(ttyLineOverflow({ line: "x".repeat(1024) })).toBe(
      "the line is 1024 bytes and a terminal keeps at most 1023 of one typed line (MAX_CANON), so the rest " +
        "would be dropped and the shell left waiting on an unclosed quote",
    );
  });

  it("counts bytes, not characters, since the terminal's limit is in bytes", () => {
    expect(ttyLineOverflow({ line: "é".repeat(512) })).toContain("the line is 1024 bytes");
  });
});

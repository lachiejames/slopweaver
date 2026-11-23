import { describe, expect, it } from "vitest";
import { unreadableFact } from "../../../../devLint/testEnshittification.js";

describe("unreadableFact — a file never compared fails the gate", () => {
  it("says nothing when every changed test file read", () => {
    expect(unreadableFact({ sha: "a".repeat(40), unreadable: [] })).toBeUndefined();
  });

  it("names every file that would not read, rather than folding it into a clean line", () => {
    expect(
      unreadableFact({
        sha: "a".repeat(40),
        unreadable: ["src/__tests__/unit/a.test.ts", "src/__tests__/unit/b.test.ts"],
      }),
    ).toBe(
      "2 changed test file(s) would not read at one end against aaaaaaaaa, so they were never compared and the gate fails: src/__tests__/unit/a.test.ts, src/__tests__/unit/b.test.ts",
    );
  });
});

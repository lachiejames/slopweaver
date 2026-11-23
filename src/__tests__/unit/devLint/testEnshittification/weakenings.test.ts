import { describe, expect, it } from "vitest";
import { weakenings } from "../../../../devLint/testAssertionCounts.js";

describe("weakenings", () => {
  const flat = { expects: 5, focused: 0, skipped: 1, strong: 3 } as const;

  it("says nothing when nothing moved", () => {
    expect(weakenings({ base: flat, deletedWithCode: [], head: flat, path: "a.test.ts" })).toEqual([]);
  });

  it("says nothing when the file got stronger", () => {
    const head = { expects: 9, focused: 0, skipped: 0, strong: 7 } as const;
    expect(weakenings({ base: flat, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([]);
  });

  it("names a fall in expect() calls", () => {
    const head = { expects: 2, focused: 0, skipped: 1, strong: 3 } as const;
    expect(weakenings({ base: flat, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 5 expect() call(s) became 2",
    ]);
  });

  it("names a fall in exact-value matchers even when the expect count held", () => {
    const head = { expects: 5, focused: 0, skipped: 1, strong: 1 } as const;
    expect(weakenings({ base: flat, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 3 exact-value matcher(s) became 1",
    ]);
  });

  it("names a rise in skipped suites", () => {
    const head = { expects: 5, focused: 0, skipped: 4, strong: 3 } as const;
    expect(weakenings({ base: flat, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 1 skipped suite(s)/case(s) became 4",
    ]);
  });

  it("names .only absolutely, even when the base carried one too", () => {
    const base = { expects: 5, focused: 2, skipped: 1, strong: 3 } as const;
    const head = { expects: 5, focused: 1, skipped: 1, strong: 3 } as const;
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 1 .only — it silences every other case in this file",
    ]);
  });

  it("reports every clause that fired, in order", () => {
    const head = { expects: 1, focused: 1, skipped: 9, strong: 0 } as const;
    expect(weakenings({ base: flat, deletedWithCode: [], head, path: "a.test.ts" }).length).toBe(4);
  });
});

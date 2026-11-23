import { describe, expect, it } from "vitest";
import { weakenings } from "../../../../devLint/testAssertionCounts.js";

describe("weakenings — a verified deletion answers the two FALL clauses and neither RISE clause", () => {
  const base = { expects: 40, focused: 0, skipped: 0, strong: 30 } as const;

  it("still names both falls when the file claims nothing", () => {
    const head = { expects: 10, focused: 0, skipped: 0, strong: 5 } as const;
    expect(weakenings({ base, deletedWithCode: [], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 40 expect() call(s) became 10",
      "a.test.ts: 30 exact-value matcher(s) became 5",
    ]);
  });

  it("says nothing about either fall once a symbol is verified gone", () => {
    const head = { expects: 10, focused: 0, skipped: 0, strong: 5 } as const;
    expect(weakenings({ base, deletedWithCode: ["parseProgressArgs"], head, path: "a.test.ts" })).toEqual([]);
  });

  it("still refuses a case switched off, because deleting code never justifies skipping one", () => {
    const head = { expects: 10, focused: 0, skipped: 2, strong: 5 } as const;
    expect(weakenings({ base, deletedWithCode: ["parseProgressArgs"], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 0 skipped suite(s)/case(s) became 2",
    ]);
  });

  it("still refuses a .only, which silences every case the deletion left standing", () => {
    const head = { expects: 10, focused: 1, skipped: 0, strong: 5 } as const;
    expect(weakenings({ base, deletedWithCode: ["parseProgressArgs"], head, path: "a.test.ts" })).toEqual([
      "a.test.ts: 1 .only — it silences every other case in this file",
    ]);
  });
});

/**
 * The shared debt-list ratchet's own tests. Three properties, and each is the rule rather than a sample: a
 * committed list decodes under whatever array key its gate uses and refuses anything else; the comparison
 * refuses a new or grown entry while never refusing one that shrank; and a rebaseline refuses only the
 * entries that GREW, so a brand-new one still widens the list.
 *
 * These used to be written twice, once per gate. That is the duplication this module exists to end, so the
 * tests move here with the code rather than staying behind as two copies of one property.
 */
import { describe, expect, it } from "vitest";
import {
  CountBaselineErrors,
  type CountEntry,
  countEntryKey,
  countEntryLabel,
  countRatchetAction,
  countRegressionsOf,
  countSlackOf,
  countWorseningsOf,
  parseCountBaseline,
} from "../../../devLint/countRatchetCore.js";
import { unwrap } from "../../../lib/result.js";

describe("an entry keyed by path and kind", () => {
  it("keys and labels a path-only entry by its path alone, and a kinded one by both", () => {
    expect(countEntryKey({ entry: { path: "a.md" } })).toBe("a.md");
    expect(countEntryKey({ entry: { kind: "date", path: "a.md" } })).toBe("a.md\u0000date");
    expect(countEntryLabel({ entry: { path: "a.md" } })).toBe("a.md");
    expect(countEntryLabel({ entry: { kind: "date", path: "a.md" } })).toBe("a.md [date]");
  });

  it("refuses a new kind in a file even when another kind there fell by more", () => {
    const baseline = [{ count: 5, kind: "date", path: "a.md" }];
    const current = [
      { count: 1, kind: "date", path: "a.md" },
      { count: 1, kind: "pr-number", path: "a.md" },
    ];

    expect(countRegressionsOf({ baseline, current })).toStrictEqual([
      { baselineCount: undefined, count: 1, kind: "pr-number", path: "a.md" },
    ]);
    expect(countSlackOf({ baseline, current, unread: [] })).toStrictEqual([
      { baselineCount: 5, count: 1, kind: "date", path: "a.md" },
    ]);
  });

  it("never calls an unread file's kinds slack, since their counts are unknown", () => {
    const baseline = [
      { count: 2, kind: "date", path: "a.md" },
      { count: 3, kind: "turn-id", path: "a.md" },
    ];

    expect(countSlackOf({ baseline, current: [], unread: ["a.md"] })).toStrictEqual([]);
  });

  it("decodes a kinded entry and keeps a path-only one without a kind field", () => {
    const text = JSON.stringify({
      files: [
        { count: 2, kind: "date", path: "a.md" },
        { count: 1, path: "b.md" },
      ],
    });

    expect(unwrap(parseCountBaseline({ gate: "g", key: "files", kinded: true, text }))).toStrictEqual([
      { count: 2, kind: "date", path: "a.md" },
      { count: 1, path: "b.md" },
    ]);
  });

  it("strips a stray kind for a path-only gate, so its identity stays the path alone", () => {
    const text = JSON.stringify({ sites: [{ count: 1, kind: "date", path: "src/a.test.ts" }] });
    const baseline = unwrap(parseCountBaseline({ gate: "g", key: "sites", kinded: false, text }));

    expect(baseline).toStrictEqual([{ count: 1, path: "src/a.test.ts" }]);
    expect(countRegressionsOf({ baseline, current: [{ count: 1, path: "src/a.test.ts" }] })).toStrictEqual([]);
  });
});

describe("countSlackOf — what an exact-debt gate refuses", () => {
  it("returns every entry above what stands, a path no longer counted reading as zero", () => {
    const baseline = [
      { count: 3, path: "a.md" },
      { count: 2, path: "b.md" },
      { count: 1, path: "gone.md" },
    ];
    const current = [
      { count: 3, path: "a.md" },
      { count: 1, path: "b.md" },
      { count: 4, path: "new.md" },
    ];

    expect(countSlackOf({ baseline, current, unread: [] })).toStrictEqual([
      { baselineCount: 2, count: 1, path: "b.md" },
      { baselineCount: 1, count: 0, path: "gone.md" },
    ]);
  });

  it("is empty when every entry matches what stands", () => {
    expect(
      countSlackOf({ baseline: [{ count: 2, path: "a.md" }], current: [{ count: 2, path: "a.md" }], unread: [] }),
    ).toStrictEqual([]);
  });

  it("refuses a second row for one path, since a debt list with a repeat is never exact", () => {
    const baseline = [
      { count: 1, path: "a.md" },
      { count: 2, path: "a.md" },
    ];

    expect(countSlackOf({ baseline, current: [{ count: 2, path: "a.md" }], unread: [] })).toStrictEqual([
      { baselineCount: 2, count: 2, path: "a.md" },
    ]);
  });

  it("never calls an unreadable path slack, since its count is unknown rather than zero", () => {
    const baseline = [
      { count: 2, path: "a.md" },
      { count: 3, path: "broken.md" },
    ];

    expect(countSlackOf({ baseline, current: [{ count: 1, path: "a.md" }], unread: ["broken.md"] })).toStrictEqual([
      { baselineCount: 2, count: 1, path: "a.md" },
    ]);
  });
});

/** One counted entry, for building a debt list in a test. */
function entry({ path, count }: { path: string; count: number }): CountEntry {
  return { count, path };
}

describe("parseCountBaseline", () => {
  it("decodes a well-formed debt list under the key its gate names", () => {
    const parsed = parseCountBaseline({
      gate: "unnamed-failure-assertion",
      key: "sites",
      kinded: false,
      text: '{ "sites": [{ "path": "src/a.test.ts", "count": 2 }] }',
    });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual([{ count: 2, path: "src/a.test.ts" }]);
  });

  it("decodes the other gate's key just as well, which is what makes one ratchet serve both", () => {
    const parsed = parseCountBaseline({
      gate: "error-shape-threshold",
      key: "directories",
      kinded: false,
      text: '{ "directories": [{ "path": "src/x", "count": 8 }] }',
    });
    expect(unwrap(parsed)).toEqual([{ count: 8, path: "src/x" }]);
  });

  it("decodes an empty debt list, which is how a fresh one is seeded", () => {
    const parsed = parseCountBaseline({ gate: "g", key: "sites", kinded: false, text: '{ "sites": [] }' });
    expect(unwrap(parsed)).toEqual([]);
  });

  it("refuses a list filed under a key this gate does not use, built through the factory the code calls", () => {
    const parsed = parseCountBaseline({ gate: "g", key: "sites", kinded: false, text: '{ "directories": [] }' });
    expect(parsed._unsafeUnwrapErr()).toEqual(
      CountBaselineErrors.malformed({ detail: "unexpected shape (expected { sites: [{ path, count }] })", gate: "g" }),
    );
  });

  it("refuses a negative count", () => {
    const parsed = parseCountBaseline({
      gate: "g",
      key: "sites",
      kinded: false,
      text: '{ "sites": [{ "path": "a", "count": -1 }] }',
    });
    expect(parsed._unsafeUnwrapErr().message).toContain("unexpected shape");
  });

  it("refuses an entry with no path", () => {
    const parsed = parseCountBaseline({
      gate: "g",
      key: "sites",
      kinded: false,
      text: '{ "sites": [{ "count": 1 }] }',
    });
    expect(parsed._unsafeUnwrapErr().message).toContain("unexpected shape");
  });

  it("refuses a top-level value that is not an object at all", () => {
    const parsed = parseCountBaseline({ gate: "g", key: "sites", kinded: false, text: "[]" });
    expect(parsed._unsafeUnwrapErr().message).toContain("unexpected shape");
  });

  it("names its own gate when the text is not JSON at all", () => {
    const parsed = parseCountBaseline({
      gate: "unnamed-failure-assertion",
      key: "sites",
      kinded: false,
      text: "not json",
    });
    expect(parsed._unsafeUnwrapErr().code).toBe("BASELINE_MALFORMED");
    expect(parsed._unsafeUnwrapErr().message).toContain("unnamed-failure-assertion debt list");
  });

  it("names the unreadable case as its own variant, so a caller can branch on which of the two failed", () => {
    expect(CountBaselineErrors.unreadable({ path: ".baselines/x.json" })).toEqual({
      code: "BASELINE_UNREADABLE",
      message: "debt list missing or unreadable at .baselines/x.json",
      path: ".baselines/x.json",
    });
  });
});

describe("countRegressionsOf — the ratchet", () => {
  const baseline = [entry({ count: 2, path: "src/a.ts" })];

  it("holds when an entry matches its debt entry exactly", () => {
    expect(countRegressionsOf({ baseline, current: [entry({ count: 2, path: "src/a.ts" })] })).toEqual([]);
  });

  it("holds when an entry has FEWER sites than its debt entry", () => {
    expect(countRegressionsOf({ baseline, current: [entry({ count: 1, path: "src/a.ts" })] })).toEqual([]);
  });

  it("holds when an entry's sites are gone entirely", () => {
    expect(countRegressionsOf({ baseline, current: [] })).toEqual([]);
  });

  it("refuses an entry whose count grew past its debt entry, and names the floor", () => {
    expect(countRegressionsOf({ baseline, current: [entry({ count: 3, path: "src/a.ts" })] })).toEqual([
      { baselineCount: 2, count: 3, path: "src/a.ts" },
    ]);
  });

  it("refuses an entry absent from the debt list, with no floor", () => {
    expect(countRegressionsOf({ baseline, current: [entry({ count: 1, path: "src/new.ts" })] })).toEqual([
      { baselineCount: undefined, count: 1, path: "src/new.ts" },
    ]);
  });

  it("reports every regression, in the order the current list carries them", () => {
    const current = [entry({ count: 3, path: "src/a.ts" }), entry({ count: 1, path: "src/b.ts" })];
    expect(countRegressionsOf({ baseline, current }).map((one) => one.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("countWorseningsOf — what a rebaseline refuses", () => {
  it("refuses an entry that grew", () => {
    const regressions = [{ baselineCount: 2, count: 3, path: "src/a.ts" }];
    expect(countWorseningsOf({ regressions })).toEqual(regressions);
  });

  it("allows a brand-new entry, which widens the list rather than an entry", () => {
    expect(countWorseningsOf({ regressions: [{ baselineCount: undefined, count: 1, path: "src/new.ts" }] })).toEqual(
      [],
    );
  });

  it("keeps only the grown entries when both kinds are present", () => {
    const regressions = [
      { baselineCount: undefined, count: 1, path: "src/new.ts" },
      { baselineCount: 2, count: 3, path: "src/a.ts" },
    ];
    expect(countWorseningsOf({ regressions }).map((one) => one.path)).toEqual(["src/a.ts"]);
  });
});

describe("countRatchetAction — an incomplete scan never vouches for the tree", () => {
  it("refuses a rebaseline over a scan that missed a file, which would write a list that forgives the unread", () => {
    expect(countRatchetAction({ complete: false, rebaseline: true, regressions: 0 })).toBe("refuse-incomplete");
    expect(countRatchetAction({ complete: false, rebaseline: true, regressions: 2 })).toBe("refuse-incomplete");
  });

  it("refuses to call an incomplete scan clean, but still reports the regressions it did find", () => {
    expect(countRatchetAction({ complete: false, rebaseline: false, regressions: 0 })).toBe("refuse-incomplete");
    expect(countRatchetAction({ complete: false, rebaseline: false, regressions: 1 })).toBe("compare");
  });

  it("rebaselines or compares a complete scan as asked", () => {
    expect(countRatchetAction({ complete: true, rebaseline: true, regressions: 3 })).toBe("rebaseline");
    expect(countRatchetAction({ complete: true, rebaseline: false, regressions: 0 })).toBe("compare");
  });
});

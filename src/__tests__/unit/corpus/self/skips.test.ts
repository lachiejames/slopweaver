import { describe, expect, it } from "vitest";

import {
  ALLOW_LARGE_FILES,
  countSelfSkips,
  type SelfSkip,
  type SelfSkipReason,
  selfSkipIsFault,
  summariseSelfSkips,
} from "../../../../corpus/self/skips.js";

/** One skip with no detail — the summary never renders `detail`, so it stays empty throughout. */
function skip({ reason, relPath }: { reason: SelfSkipReason; relPath: string }): SelfSkip {
  return { detail: "", reason, relPath };
}

describe("ALLOW_LARGE_FILES", () => {
  it("is the literal environment variable that lifts the size ceiling", () => {
    expect(ALLOW_LARGE_FILES).toBe("SLOPWEAVER_ALLOW_LARGE_FILES");
  });
});

describe("selfSkipIsFault", () => {
  it("is true for exactly the two fault reasons and false for every policy and guardrail reason", () => {
    const reasons: readonly SelfSkipReason[] = [
      "excluded-path",
      "unsupported-extension",
      "symlink",
      "inside-home",
      "excluded-directory",
      "too-large",
      "binary-content",
      "unreadable",
    ];
    expect(reasons.map((reason) => [reason, selfSkipIsFault({ reason })])).toEqual([
      ["excluded-path", false],
      ["unsupported-extension", false],
      ["symlink", false],
      ["inside-home", false],
      ["excluded-directory", false],
      ["too-large", false],
      ["binary-content", true],
      ["unreadable", true],
    ]);
  });
});

describe("countSelfSkips", () => {
  it("counts duplicates per reason and reports them in the fixed severity-first order, whatever the input order", () => {
    const skips = [
      skip({ reason: "excluded-directory", relPath: "a" }),
      skip({ reason: "unsupported-extension", relPath: "b" }),
      skip({ reason: "too-large", relPath: "c" }),
      skip({ reason: "unsupported-extension", relPath: "d" }),
      skip({ reason: "unreadable", relPath: "e" }),
      skip({ reason: "symlink", relPath: "f" }),
      skip({ reason: "binary-content", relPath: "g" }),
      skip({ reason: "inside-home", relPath: "h" }),
      skip({ reason: "excluded-path", relPath: "i" }),
      skip({ reason: "unreadable", relPath: "j" }),
    ];
    expect(countSelfSkips({ skips })).toEqual([
      { count: 2, reason: "unreadable", skipClass: "fault" },
      { count: 1, reason: "binary-content", skipClass: "fault" },
      { count: 1, reason: "too-large", skipClass: "guardrail" },
      { count: 1, reason: "excluded-path", skipClass: "policy" },
      { count: 2, reason: "unsupported-extension", skipClass: "policy" },
      { count: 1, reason: "symlink", skipClass: "policy" },
      { count: 1, reason: "inside-home", skipClass: "policy" },
      { count: 1, reason: "excluded-directory", skipClass: "policy" },
    ]);
  });

  it("omits every reason that did not occur, and is empty for no skips", () => {
    expect(countSelfSkips({ skips: [skip({ reason: "symlink", relPath: "x" })] })).toEqual([
      { count: 1, reason: "symlink", skipClass: "policy" },
    ]);
    expect(countSelfSkips({ skips: [] })).toEqual([]);
  });
});

describe("summariseSelfSkips", () => {
  it("reports an explicit zero line, and only that line, for no skips", () => {
    expect(summariseSelfSkips({ skips: [] })).toEqual(["declined: 0 entr(ies) — every entry the walk saw was read"]);
  });

  it("names the first three paths of a fault reason and not a fourth, one guardrail path, and no policy path", () => {
    const skips = [
      skip({ reason: "unsupported-extension", relPath: "notes/a.org" }),
      skip({ reason: "unreadable", relPath: "one.md" }),
      skip({ reason: "unreadable", relPath: "two.md" }),
      skip({ reason: "too-large", relPath: "huge.md" }),
      skip({ reason: "unreadable", relPath: "three.md" }),
      skip({ reason: "unsupported-extension", relPath: "notes/b.rst" }),
      skip({ reason: "unreadable", relPath: "four.md" }),
    ];
    expect(summariseSelfSkips({ skips })).toEqual([
      "declined: 7 entr(ies) across 3 reason(s)",
      "  unreadable [fault]: 4 — could not be read at all",
      "    one.md",
      "    two.md",
      "    three.md",
      "  too-large [guardrail]: 1 — larger than the per-file ceiling — set SLOPWEAVER_ALLOW_LARGE_FILES=1 to read it anyway",
      "    huge.md",
      "  unsupported-extension [policy]: 2 — not one of the extensions the corpus is read from",
    ]);
  });

  it("names all three paths when a fault reason has exactly three", () => {
    const skips = [
      skip({ reason: "binary-content", relPath: "a.md" }),
      skip({ reason: "binary-content", relPath: "b.md" }),
      skip({ reason: "binary-content", relPath: "c.md" }),
    ];
    expect(summariseSelfSkips({ skips })).toEqual([
      "declined: 3 entr(ies) across 1 reason(s)",
      "  binary-content [fault]: 3 — control bytes are dense enough that this is a blob rather than prose",
      "    a.md",
      "    b.md",
      "    c.md",
    ]);
  });
});

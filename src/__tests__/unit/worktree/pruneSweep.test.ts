/**
 * The scan bound, and the rule the nightly run was silently breaking for a fortnight: the apply budget is
 * counted from the moment the SCAN ENDED, never from process start.
 *
 * `applyDeadlineMs` is a one-line function precisely so that rule has somewhere to be asserted. The old code
 * expressed it as `Date.now() + budgetMs` at the top of `runWorktreePrune`, where nothing could pin it, and
 * two consecutive recipe slots ran 929.8 s and 982.4 s against a 900 s budget and removed nothing at all.
 */
import { describe, expect, it } from "vitest";

import type { WorktreeInfo } from "../../../cmux/worktreeList.js";
import type { PruneVerdict } from "../../../worktree/pruneClassify.js";
import {
  APPLY_LEASE_MS,
  applyDeadlineMs,
  applyLeaseRefusal,
  coldestFirst,
  mergeScanCursors,
  mirrorPassDeadlineMs,
  type RepoShortfall,
  resumeAfter,
  type ScanCursor,
  type ScanEntry,
  scanOrder,
  sweepWithin,
  unreachedLine,
} from "../../../worktree/pruneSweep.js";

const SLOPWEAVER = "/dev/slopweaver";
const MINUTE = 60_000;
const ACME_ADMIN = "/dev/acme-admin";

/** One queued worktree, named so an assertion can read which repository and which tree it is. */
const entry = ({
  repoRoot,
  name,
  coldnessMs,
}: {
  repoRoot: string;
  name: string;
  coldnessMs: number | null;
}): ScanEntry => ({
  coldnessMs,
  repoRoot,
  worktree: { branch: name, path: `${repoRoot}/.claude/worktrees.noindex/${name}` } satisfies WorktreeInfo,
});

/** A queue of `count` entries for one repository, warmest last. */
const queue = ({ repoRoot, count }: { repoRoot: string; count: number }): readonly ScanEntry[] =>
  Array.from({ length: count }, (_unused, index) =>
    entry({ coldnessMs: index, name: `${repoRoot.slice(5)}-${String(index)}`, repoRoot }),
  );

/** A verdict standing in for whatever the real classifier would have said about one entry. */
const verdictFor = ({ item }: { item: ScanEntry }): PruneVerdict => ({
  branch: item.worktree.branch,
  cls: "merged",
  deleteBranch: true,
  dropsDeps: false,
  diskKib: null,
  path: item.worktree.path,
  reason: "classified",
});

/** A clock that advances one millisecond per reading — a seam, not a mock. */
const tickingClock = ({ from }: { from: number }): (() => number) => {
  let ms = from;
  return () => {
    ms += 1;
    return ms;
  };
};

describe("mirrorPassDeadlineMs", () => {
  it("keeps the removal window's own end while it is further off than the floor", () => {
    expect(mirrorPassDeadlineMs({ deadlineMs: 1_900_000, nowMs: 1_000_000 })).toBe(1_900_000);
  });

  it("gives the mirror pass two minutes once the removals spent the whole window", () => {
    expect(mirrorPassDeadlineMs({ deadlineMs: 900_000, nowMs: 1_000_000 })).toBe(1_120_000);
  });
});

describe("applyDeadlineMs", () => {
  it("counts the removal budget from when the SCAN ENDED, not from when the run started", () => {
    // The regression, stated as one assertion. The run starts at 0; the scan takes 900_000 ms, exactly the
    // default budget; the removals must still get their full 900_000 ms after it.
    expect(applyDeadlineMs({ budgetMs: 900_000, scanEndedMs: 900_000 })).toBe(1_800_000);
  });

  it("gives a run whose scan overran its whole allowance a deadline that is still in the future", () => {
    const scanEndedMs = 982_431;
    expect(applyDeadlineMs({ budgetMs: 900_000, scanEndedMs })).toBeGreaterThan(scanEndedMs);
  });
});

describe("coldestFirst", () => {
  it("orders by directory mtime ascending, so a bounded scan spends itself on the coldest trees", () => {
    const ordered = coldestFirst({
      entries: [
        entry({ coldnessMs: 300, name: "warm", repoRoot: SLOPWEAVER }),
        entry({ coldnessMs: 100, name: "coldest", repoRoot: SLOPWEAVER }),
        entry({ coldnessMs: 200, name: "middling", repoRoot: SLOPWEAVER }),
      ],
    });
    expect(ordered.map((item) => item.worktree.branch)).toEqual(["coldest", "middling", "warm"]);
  });

  it("puts an unreadable mtime FIRST, because a stale registration costs nothing to classify", () => {
    const ordered = coldestFirst({
      entries: [
        entry({ coldnessMs: 100, name: "cold", repoRoot: SLOPWEAVER }),
        entry({ coldnessMs: null, name: "unstattable", repoRoot: SLOPWEAVER }),
      ],
    });
    expect(ordered.map((item) => item.worktree.branch)).toEqual(["unstattable", "cold"]);
  });

  it("breaks an equal stamp by path, so the order is total whatever order git listed the trees in", () => {
    const entries = [
      entry({ coldnessMs: 5, name: "c", repoRoot: SLOPWEAVER }),
      entry({ coldnessMs: 5, name: "a", repoRoot: SLOPWEAVER }),
      entry({ coldnessMs: 5, name: "b", repoRoot: SLOPWEAVER }),
    ];
    expect(coldestFirst({ entries }).map((item) => item.worktree.branch)).toEqual(["a", "b", "c"]);
  });

  it("orders an empty queue to an empty queue", () => {
    expect(coldestFirst({ entries: [] })).toEqual([]);
  });
});

describe("scanOrder", () => {
  it("takes one worktree from each repository in turn, so a bound cannot starve the second one", () => {
    const ordered = scanOrder({
      repos: [queue({ count: 3, repoRoot: SLOPWEAVER }), queue({ count: 2, repoRoot: ACME_ADMIN })],
    });
    expect(ordered.map((item) => item.repoRoot)).toEqual([SLOPWEAVER, ACME_ADMIN, SLOPWEAVER, ACME_ADMIN, SLOPWEAVER]);
  });
});

describe("resumeAfter", () => {
  const names = ({ entries }: { entries: readonly ScanEntry[] }): readonly (string | null)[] =>
    entries.map((item) => item.worktree.branch);

  it("starts past the cursor and wraps to the coldest after the end", () => {
    const entries = queue({ count: 5, repoRoot: SLOPWEAVER });
    const resumed = resumeAfter({
      cursor: {
        afterColdnessMs: 2,
        afterPath: `${SLOPWEAVER}/.claude/worktrees.noindex/slopweaver-2`,
        repoRoot: SLOPWEAVER,
        waited: 0,
      },
      entries,
    });
    expect(names({ entries: resumed })).toEqual([
      "slopweaver-3",
      "slopweaver-4",
      "slopweaver-0",
      "slopweaver-1",
      "slopweaver-2",
    ]);
  });

  it("resumes past a stamp whose entry is gone, which is the tree the last run removed", () => {
    const entries = [0, 10, 20].map((coldnessMs) =>
      entry({ coldnessMs, name: String(coldnessMs), repoRoot: SLOPWEAVER }),
    );
    const resumed = resumeAfter({
      cursor: {
        afterColdnessMs: 5,
        afterPath: `${SLOPWEAVER}/.claude/worktrees.noindex/gone`,
        repoRoot: SLOPWEAVER,
        waited: 0,
      },
      entries,
    });
    expect(names({ entries: resumed })).toEqual(["10", "20", "0"]);
  });

  it("resumes past the unreadable-mtime group when the cursor stopped inside it", () => {
    const entries = [
      entry({ coldnessMs: null, name: "unstattable", repoRoot: SLOPWEAVER }),
      entry({ coldnessMs: 1, name: "cold", repoRoot: SLOPWEAVER }),
    ];
    const resumed = resumeAfter({
      cursor: {
        afterColdnessMs: null,
        afterPath: `${SLOPWEAVER}/.claude/worktrees.noindex/unstattable`,
        repoRoot: SLOPWEAVER,
        waited: 0,
      },
      entries,
    });
    expect(names({ entries: resumed })).toEqual(["cold", "unstattable"]);
  });

  it("starts at the coldest when the cursor is past every entry, or there is none", () => {
    const entries = queue({ count: 3, repoRoot: SLOPWEAVER });
    expect(
      names({
        entries: resumeAfter({
          cursor: {
            afterColdnessMs: 99,
            afterPath: `${SLOPWEAVER}/.claude/worktrees.noindex/zz`,
            repoRoot: SLOPWEAVER,
            waited: 0,
          },
          entries,
        }),
      }),
    ).toEqual(names({ entries }));
    expect(names({ entries: resumeAfter({ cursor: undefined, entries }) })).toEqual(names({ entries }));
  });
});

describe("sweepWithin", () => {
  it("reaches the whole queue across bounded runs, where a fixed prefix of holds would starve the rest", () => {
    // Ten trees, a budget of three per run, and nothing ever removed: the worst case for a stable order.
    const repo = queue({ count: 10, repoRoot: SLOPWEAVER });
    let cursors: readonly ScanCursor[] = [];
    const reached = new Set<string>();
    for (let run = 0; run < 4; run += 1) {
      const swept = sweepWithin({
        classify: (item) => verdictFor({ item }),
        deadlineMs: 4,
        entries: scanOrder({ cursors, repos: [repo] }),
        nowMs: tickingClock({ from: 0 }),
        previous: cursors,
        repoRoots: [SLOPWEAVER],
      });
      swept.plans[0]!.verdicts.forEach((verdict) => reached.add(verdict.path));
      cursors = swept.cursors;
    }
    expect(reached.size).toBe(10);
  });

  it("walks through a group of EQUAL stamps wider than one run, which a stamp-only cursor restarted forever", () => {
    // Ten trees sharing one mtime, three per run, nothing ever removed.
    const repo = Array.from({ length: 10 }, (_unused, index) =>
      entry({ coldnessMs: 5, name: `tied-${String(index)}`, repoRoot: SLOPWEAVER }),
    );
    let cursors: readonly ScanCursor[] = [];
    const reached = new Set<string>();
    for (let run = 0; run < 4; run += 1) {
      const swept = sweepWithin({
        classify: (item) => verdictFor({ item }),
        deadlineMs: 4,
        entries: scanOrder({ cursors, repos: [repo] }),
        nowMs: tickingClock({ from: 0 }),
        previous: cursors,
        repoRoots: [SLOPWEAVER],
      });
      swept.plans[0]!.verdicts.forEach((verdict) => reached.add(verdict.path));
      cursors = swept.cursors;
    }
    expect(reached.size).toBe(10);
  });

  it.each([2, 3, 4])(
    "leads with the longest-waiting repository, so %i repositories on one classification a run all drain",
    (repoCount) => {
      // Three trees in each repository, one classification per run.
      const roots = Array.from({ length: repoCount }, (_, index) => `/dev/repo-${index}`);
      const repos = roots.map((repoRoot) => queue({ count: 3, repoRoot }));
      let cursors: readonly ScanCursor[] = [];
      const reached = new Set<string>();
      for (let run = 0; run < 3 * repoCount; run += 1) {
        const swept = sweepWithin({
          classify: (item) => verdictFor({ item }),
          deadlineMs: 2,
          entries: scanOrder({ cursors, repos }),
          nowMs: tickingClock({ from: 0 }),
          previous: cursors,
          repoRoots: roots,
        });
        swept.plans.forEach((plan) => plan.verdicts.forEach((verdict) => reached.add(verdict.path)));
        cursors = swept.cursors;
      }
      expect(reached.size).toBe(3 * repoCount);
    },
  );

  it("clears the cursor of a repository it scanned whole, and keeps the one it never reached", () => {
    const previous: readonly ScanCursor[] = [
      { afterColdnessMs: 1, afterPath: `${ACME_ADMIN}/x`, repoRoot: ACME_ADMIN, waited: 0 },
    ];
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 3,
      entries: queue({ count: 2, repoRoot: SLOPWEAVER }),
      nowMs: tickingClock({ from: 0 }),
      previous,
      repoRoots: [SLOPWEAVER, ACME_ADMIN],
    });
    expect(swept.cursors).toEqual([]);
    const starved = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 0,
      entries: queue({ count: 2, repoRoot: ACME_ADMIN }),
      nowMs: tickingClock({ from: 0 }),
      previous,
      repoRoots: [ACME_ADMIN],
    });
    expect(starved.cursors).toEqual([{ ...previous[0]!, waited: 1 }]);
  });

  it("records the stamp of the last tree it classified in a repository it left short", () => {
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 3,
      entries: queue({ count: 5, repoRoot: SLOPWEAVER }),
      nowMs: tickingClock({ from: 0 }),
      repoRoots: [SLOPWEAVER],
    });
    expect(swept.cursors).toEqual([
      {
        afterColdnessMs: 1,
        afterPath: `${SLOPWEAVER}/.claude/worktrees.noindex/slopweaver-1`,
        repoRoot: SLOPWEAVER,
        waited: 0,
      },
    ]);
  });

  it("spreads a bound across repositories instead of spending it all inside the first", () => {
    // 756 and 90 are this machine's real counts. A clock ticking once per reading admits
    // exactly 100 classifications, and the round-robin must give acme-admin its half of them.
    const entries = scanOrder({
      repos: [queue({ count: 756, repoRoot: SLOPWEAVER }), queue({ count: 90, repoRoot: ACME_ADMIN })],
    });
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 101,
      entries,
      nowMs: tickingClock({ from: 0 }),
      repoRoots: [SLOPWEAVER, ACME_ADMIN],
    });
    const scanned = new Map(swept.shortfalls.map((row) => [row.repoRoot, row.scanned]));
    expect(scanned.get(SLOPWEAVER)).toBe(50);
    expect(scanned.get(ACME_ADMIN)).toBe(50);
  });

  it("reports the per-repository shortfall, so a partial census cannot read as a whole one", () => {
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 3,
      entries: scanOrder({
        repos: [queue({ count: 5, repoRoot: SLOPWEAVER }), queue({ count: 5, repoRoot: ACME_ADMIN })],
      }),
      nowMs: tickingClock({ from: 0 }),
      repoRoots: [SLOPWEAVER, ACME_ADMIN],
    });
    expect(swept.shortfalls).toEqual([
      { repoRoot: SLOPWEAVER, scanned: 1, unreached: 4 },
      { repoRoot: ACME_ADMIN, scanned: 1, unreached: 4 },
    ]);
  });

  it("classifies nothing when the deadline has already passed, rather than one more anyway", () => {
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 0,
      entries: queue({ count: 5, repoRoot: SLOPWEAVER }),
      nowMs: tickingClock({ from: 1_000 }),
      repoRoots: [SLOPWEAVER],
    });
    expect(swept.plans).toEqual([{ repoRoot: SLOPWEAVER, verdicts: [] }]);
    expect(swept.shortfalls).toEqual([{ repoRoot: SLOPWEAVER, scanned: 0, unreached: 5 }]);
  });

  it("reports a repository it reached entirely with a zero shortfall, not by omitting it", () => {
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 1_000_000,
      entries: queue({ count: 3, repoRoot: SLOPWEAVER }),
      nowMs: tickingClock({ from: 0 }),
      repoRoots: [SLOPWEAVER, ACME_ADMIN],
    });
    expect(swept.shortfalls).toEqual([
      { repoRoot: SLOPWEAVER, scanned: 3, unreached: 0 },
      { repoRoot: ACME_ADMIN, scanned: 0, unreached: 0 },
    ]);
    expect(swept.plans.map((plan) => plan.verdicts.length)).toEqual([3, 0]);
  });

  it("keeps each verdict with the repository whose git has to carry it out", () => {
    const swept = sweepWithin({
      classify: (item) => verdictFor({ item }),
      deadlineMs: 1_000_000,
      entries: scanOrder({
        repos: [queue({ count: 2, repoRoot: SLOPWEAVER }), queue({ count: 2, repoRoot: ACME_ADMIN })],
      }),
      nowMs: tickingClock({ from: 0 }),
      repoRoots: [SLOPWEAVER, ACME_ADMIN],
    });
    const acmeAdmin = swept.plans.find((plan) => plan.repoRoot === ACME_ADMIN)!;
    expect(acmeAdmin.verdicts.every((verdict) => verdict.path.startsWith(ACME_ADMIN))).toBe(true);
    expect(acmeAdmin.verdicts.length).toBe(2);
  });
});

describe("unreachedLine", () => {
  it("names the shortfall per repository, and says the counts above it are partial", () => {
    const shortfalls: readonly RepoShortfall[] = [
      { repoRoot: SLOPWEAVER, scanned: 100, unreached: 656 },
      { repoRoot: ACME_ADMIN, scanned: 90, unreached: 0 },
    ];
    expect(unreachedLine({ shortfalls })).toBe(
      "scan budget reached with worktrees never looked at — 656 of 756 in /dev/slopweaver. " +
        "Every count above is a PARTIAL census of those repositories; the next --apply resumes past where this one stopped.",
    );
  });

  it("separates two shortfalls, because one total over two repositories is the ambiguity to avoid", () => {
    const line = unreachedLine({
      shortfalls: [
        { repoRoot: SLOPWEAVER, scanned: 10, unreached: 4 },
        { repoRoot: ACME_ADMIN, scanned: 10, unreached: 8 },
      ],
    });
    expect(line).toContain("4 of 14 in /dev/slopweaver · 8 of 18 in /dev/acme-admin");
  });

  it("says nothing at all when every queued worktree was classified", () => {
    expect(unreachedLine({ shortfalls: [{ repoRoot: SLOPWEAVER, scanned: 756, unreached: 0 }] })).toBeUndefined();
    expect(unreachedLine({ shortfalls: [] })).toBeUndefined();
  });
});

describe("applyLeaseRefusal", () => {
  it("lets the longest drain yet run, 480 minutes of removals after a 20-minute scan", () => {
    expect(applyLeaseRefusal({ budgetMs: 480 * MINUTE, scanBudgetMs: 20 * MINUTE })).toBe(null);
  });

  it("allows budgets that exactly fill the eleven-hour ceiling", () => {
    expect(applyLeaseRefusal({ budgetMs: 645 * MINUTE, scanBudgetMs: 15 * MINUTE })).toBe(null);
  });

  it("refuses budgets past it, which the next slot would take the lock from mid-drain", () => {
    expect(applyLeaseRefusal({ budgetMs: 646 * MINUTE, scanBudgetMs: 15 * MINUTE })).toBe(
      "worktree prune: --budget plus --scan-budget comes to 661m, past the 660m an apply may hold its lock — split the drain into shorter runs",
    );
  });

  it("keeps the ceiling inside the lease, with an hour for the removal started just before the deadline", () => {
    expect(APPLY_LEASE_MS).toBe(720 * MINUTE);
  });
});

describe("mergeScanCursors", () => {
  const a = { afterColdnessMs: 5, afterPath: "/a/x", repoRoot: "/a", waited: 0 };
  const b = { afterColdnessMs: 7, afterPath: "/b/y", repoRoot: "/b", waited: 2 };

  it("keeps another repository's cursor when an apply narrowed with --repo never queued it", () => {
    const aNow = { ...a, afterPath: "/a/z" };
    expect(mergeScanCursors({ previous: [a, b], queued: new Set(["/a"]), written: [aNow] })).toEqual([b, aNow]);
  });

  it("drops a queued repository's old cursor once this scan reached it and wrote none", () => {
    expect(mergeScanCursors({ previous: [a, b], queued: new Set(["/a", "/b"]), written: [] })).toEqual([]);
  });
});

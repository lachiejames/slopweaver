import { describe, expect, it } from "vitest";

import type { PruneClass, PruneVerdict } from "../../../worktree/pruneClassify.js";
import {
  type ApplyMemory,
  applicable,
  applyOrder,
  backlogLine,
  interleave,
  memoryKey,
  nextApplyMemory,
  type RepoPlan,
} from "../../../worktree/pruneOrder.js";

/** One verdict, named by its path so an order assertion reads as a list of names. */
const verdict = ({ path, cls }: { path: string; cls: PruneClass }): PruneVerdict => ({
  branch: path,
  cls,
  deleteBranch: cls === "merged",
  dropsDeps: false,
  diskKib: 1,
  path,
  reason: cls,
});

describe("interleave", () => {
  it("takes one item from each list in turn", () => {
    expect(interleave({ lists: [["a1", "a2", "a3"], ["b1"], ["c1", "c2"]] })).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "c2",
      "a3",
    ]);
  });

  it("is the empty list when there is nothing to take", () => {
    expect(interleave({ lists: [] })).toEqual([]);
  });
});

describe("nextApplyMemory", () => {
  it("records kept attempts, carries untouched ones, forgets the removed and those no longer worktrees", () => {
    const previous: ApplyMemory = {
      kept: [
        { attemptedAtMs: 1, path: "/a", repoRoot: "/r" },
        { attemptedAtMs: 2, path: "/b", repoRoot: "/r" },
        { attemptedAtMs: 3, path: "/gone", repoRoot: "/r" },
        { attemptedAtMs: 4, path: "/unlisted/x", repoRoot: "/unlisted" },
      ],
      repos: [
        { lastAttemptMs: 3, repoRoot: "/r" },
        { lastAttemptMs: 9, repoRoot: "/other" },
      ],
    };
    const next = nextApplyMemory({
      attempted: [
        { atMs: 50, path: "/b", removed: true, repoRoot: "/r" },
        { atMs: 60, path: "/c", removed: false, repoRoot: "/r" },
      ],
      listed: new Set(["/r"]),
      previous,
      // `/a` is still a worktree though no plan this run named it; `/gone` is not; `/unlisted` was not read.
      registered: new Set(["/a", "/b", "/c"].map((path) => memoryKey({ path, repoRoot: "/r" }))),
    });
    expect(next).toEqual({
      kept: [
        { attemptedAtMs: 1, path: "/a", repoRoot: "/r" },
        { attemptedAtMs: 4, path: "/unlisted/x", repoRoot: "/unlisted" },
        { attemptedAtMs: 60, path: "/c", repoRoot: "/r" },
      ],
      repos: [
        { lastAttemptMs: 60, repoRoot: "/r" },
        { lastAttemptMs: 9, repoRoot: "/other" },
      ],
    });
  });

  it("knows a tree by its repository and path, so a path another repository reuses is neither kept nor forgets", () => {
    // `/wt/shared` was a kept `/old` worktree; `/new` registers the same path afresh.
    const previous: ApplyMemory = {
      kept: [
        { attemptedAtMs: 100, path: "/wt/shared", repoRoot: "/old" },
        { attemptedAtMs: 1, path: "/wt/retry", repoRoot: "/new" },
      ],
      repos: [],
    };
    const next = nextApplyMemory({
      attempted: [{ atMs: 200, path: "/wt/shared", removed: false, repoRoot: "/new" }],
      listed: new Set(["/new"]),
      previous,
      registered: new Set(["/wt/shared", "/wt/retry"].map((path) => memoryKey({ path, repoRoot: "/new" }))),
    });
    expect(next.kept).toEqual([
      { attemptedAtMs: 100, path: "/wt/shared", repoRoot: "/old" },
      { attemptedAtMs: 1, path: "/wt/retry", repoRoot: "/new" },
      { attemptedAtMs: 200, path: "/wt/shared", repoRoot: "/new" },
    ]);
  });

  it("forgets a listed repository's kept tree once its path is registered only under another repository", () => {
    const next = nextApplyMemory({
      attempted: [],
      listed: new Set(["/old", "/new"]),
      previous: { kept: [{ attemptedAtMs: 100, path: "/wt/shared", repoRoot: "/old" }], repos: [] },
      registered: new Set([memoryKey({ path: "/wt/shared", repoRoot: "/new" })]),
    });
    expect(next.kept).toEqual([]);
  });
});

describe("applicable", () => {
  it("acts on merged, interrupted and pushed by default — the owner's untouched-over-24h rule", () => {
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "merged", path: "m" }) })).toBe(true);
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "interrupted", path: "i" }) })).toBe(true);
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "pushed", path: "p" }) })).toBe(true);
  });

  it("never acts on a held or a gone verdict", () => {
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "hold", path: "h" }) })).toBe(false);
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "gone", path: "g" }) })).toBe(false);
  });

  it("drops pushed alone under --merged-only", () => {
    expect(applicable({ mergedOnly: true, verdict: verdict({ cls: "pushed", path: "p" }) })).toBe(false);
    expect(applicable({ mergedOnly: true, verdict: verdict({ cls: "merged", path: "m" }) })).toBe(true);
    expect(applicable({ mergedOnly: true, verdict: verdict({ cls: "interrupted", path: "i" }) })).toBe(true);
  });

  it("acts on a spent lap tree by default, and never under --merged-only", () => {
    expect(applicable({ mergedOnly: false, verdict: verdict({ cls: "lap", path: "l" }) })).toBe(true);
    expect(applicable({ mergedOnly: true, verdict: verdict({ cls: "lap", path: "l" }) })).toBe(false);
  });
});

describe("applyOrder", () => {
  it("tries every never-attempted tree before a kept one, and the kept ones longest-ago first", () => {
    const plans: readonly RepoPlan[] = [
      { repoRoot: "/s", verdicts: ["/s/1", "/s/2", "/s/3"].map((path) => verdict({ cls: "salvaged", path })) },
      { repoRoot: "/e", verdicts: ["/e/1", "/e/2"].map((path) => verdict({ cls: "pushed", path })) },
    ];
    const memory: ApplyMemory = {
      kept: [
        { attemptedAtMs: 20, path: "/s/1", repoRoot: "/s" },
        { attemptedAtMs: 10, path: "/e/1", repoRoot: "/e" },
      ],
      repos: [
        { lastAttemptMs: 20, repoRoot: "/s" },
        { lastAttemptMs: 10, repoRoot: "/e" },
      ],
    };
    const order = applyOrder({ memory, mergedOnly: false, plans });
    // `/e` was attempted longer ago, so it leads the rotation.
    expect(order.map((item) => item.verdict.path)).toEqual(["/e/2", "/s/2", "/s/3", "/e/1", "/s/1"]);
  });

  it("orders a path another repository reuses as never attempted there", () => {
    const memory: ApplyMemory = {
      kept: [
        { attemptedAtMs: 100, path: "/wt/shared", repoRoot: "/old" },
        { attemptedAtMs: 1, path: "/wt/retry", repoRoot: "/new" },
      ],
      repos: [],
    };
    const plans: readonly RepoPlan[] = [
      { repoRoot: "/new", verdicts: ["/wt/retry", "/wt/shared"].map((path) => verdict({ cls: "merged", path })) },
    ];
    const order = applyOrder({ memory, mergedOnly: false, plans });
    expect(order.map((item) => item.verdict.path)).toEqual(["/wt/shared", "/wt/retry"]);
  });

  it("reaches every tree within as many runs as there are trees when the first attempt eats each budget", () => {
    // Each run attempts ONE tree. `/s/1` declines every time — a push stalled past the budget.
    // Every other attempt removes its tree, so it leaves the plan.
    let remaining = ["/s/1", "/s/2", "/s/3", "/e/1", "/e/2"];
    let memory: ApplyMemory = { kept: [], repos: [] };
    const attempted: string[] = [];
    for (let run = 0; run < 5; run += 1) {
      const plans: readonly RepoPlan[] = ["/s", "/e"].map((repoRoot) => ({
        repoRoot,
        verdicts: remaining
          .filter((path) => path.startsWith(`${repoRoot}/`))
          .map((path) => verdict({ cls: "salvaged", path })),
      }));
      const order = applyOrder({ memory, mergedOnly: false, plans });
      const { repoRoot, verdict: first } = order[0]!;
      const { path } = first;
      const removed = path !== "/s/1";
      attempted.push(path);
      memory = nextApplyMemory({
        attempted: [{ atMs: run, path, removed, repoRoot }],
        listed: new Set(["/s", "/e"]),
        previous: memory,
        registered: new Set(remaining.map((each) => memoryKey({ path: each, repoRoot: `/${each.split("/")[1]!}` }))),
      });
      remaining = remaining.filter((each) => each !== path || !removed);
    }
    expect(attempted).toEqual(["/s/1", "/e/1", "/s/2", "/e/2", "/s/3"]);
    expect(remaining).toEqual(["/s/1"]);
  });

  it("keeps a kept tree behind the fresh ones across a bounded scan that plans only part of the queue", () => {
    // The scan classifies two of four trees a run, alternating windows; `/r/a` declines every attempt and
    // one attempt fits a run. A memory keyed on the PLAN forgets `/r/a` on the `c, d` run.
    let remaining = ["/r/a", "/r/b", "/r/c", "/r/d"];
    let memory: ApplyMemory = { kept: [], repos: [] };
    const attempted: string[] = [];
    for (let run = 0; run < 4; run += 1) {
      const window = run % 2 === 0 ? ["/r/a", "/r/b"] : ["/r/c", "/r/d"];
      const plans: readonly RepoPlan[] = [
        {
          repoRoot: "/r",
          verdicts: window.filter((path) => remaining.includes(path)).map((path) => verdict({ cls: "salvaged", path })),
        },
      ];
      const { verdict: first } = applyOrder({ memory, mergedOnly: false, plans })[0]!;
      const removed = first.path !== "/r/a";
      attempted.push(first.path);
      memory = nextApplyMemory({
        attempted: [{ atMs: run, path: first.path, removed, repoRoot: "/r" }],
        listed: new Set(["/r"]),
        previous: memory,
        registered: new Set(remaining.map((each) => memoryKey({ path: each, repoRoot: "/r" }))),
      });
      remaining = remaining.filter((each) => each !== first.path || !removed);
    }
    expect(attempted).toEqual(["/r/a", "/r/c", "/r/b", "/r/d"]);
    expect(remaining).toEqual(["/r/a"]);
  });

  it("rotates between repositories, so a bound cannot starve the second one", () => {
    const order = applyOrder({
      mergedOnly: false,
      plans: [
        {
          repoRoot: "/slopweaver",
          verdicts: [
            verdict({ cls: "merged", path: "/s/1" }),
            verdict({ cls: "merged", path: "/s/2" }),
            verdict({ cls: "merged", path: "/s/3" }),
          ],
        },
        { repoRoot: "/acme-admin", verdicts: [verdict({ cls: "pushed", path: "/e/1" })] },
      ],
    });
    expect(order.map((item) => item.verdict.path)).toEqual(["/s/1", "/e/1", "/s/2", "/s/3"]);
    expect(order[1]!.repoRoot).toBe("/acme-admin");
  });

  it("leaves out everything the classes hold", () => {
    const order = applyOrder({
      mergedOnly: false,
      plans: [
        {
          repoRoot: "/slopweaver",
          verdicts: [verdict({ cls: "hold", path: "/s/held" }), verdict({ cls: "gone", path: "/s/gone" })],
        },
      ],
    });
    expect(order).toEqual([]);
  });
});

describe("backlogLine", () => {
  it("is undefined when the budget reached everything", () => {
    expect(backlogLine({ remaining: [] })).toBeUndefined();
  });

  it("counts the shortfall per repository", () => {
    expect(
      backlogLine({
        remaining: [
          { repoRoot: "/slopweaver", verdict: verdict({ cls: "merged", path: "/s/1" }) },
          { repoRoot: "/acme-admin", verdict: verdict({ cls: "pushed", path: "/e/1" }) },
          { repoRoot: "/slopweaver", verdict: verdict({ cls: "merged", path: "/s/2" }) },
        ],
      }),
    ).toBe(
      "budget reached with 3 removal(s) still owed — 2 in /slopweaver · 1 in /acme-admin. " +
        "Nothing was cut short: the next run re-plans and resumes.",
    );
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lapPlan } from "../../../../../cli/commands/github/lapCore.js";
import type { GithubLapDeps } from "../../../../../cli/commands/github/lapDeps.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import {
  ARGS,
  BASE,
  type BatchDepsOptions,
  batchDeps,
  MEMBERS,
  observe,
  sha,
  statesOn,
} from "../../../../lapBatchFixture.js";

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** The batch fakes over a fresh home this file removes after each test. */
function depsFor(options: BatchDepsOptions): GithubLapDeps {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-batch-"));
  homes.push(home);
  return batchDeps({ ...options, home });
}

describe("runGithubLap over a batch", () => {
  it("laps the chain's last commit once, posts every member green, lands them in order, and frees the lock last", async () => {
    const observed = observe();
    const deps = depsFor({ moved: { 9: ["b.ts"] }, observed });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(0);
    expect(observed.ran).toEqual(lapPlan().map((step) => step.id));
    expect(observed.checkedOut[0]).toBe(sha({ tag: "s9" }));
    expect(observed.envs[0]!["SLOPWEAVER_COVERAGE_BASE_SHA"]).toBe(BASE);
    for (const number of MEMBERS) {
      expect(statesOn({ number, observed })).toEqual(["pending", "pending", "success", "success"]);
    }
    expect(observed.landing).toEqual([
      "hold #7",
      "merge #7 acknowledging none",
      "release #7",
      "hold #8",
      "merge #8 acknowledging base-moved",
      "release #8",
      "hold #9",
      "merge #9 acknowledging b.ts,base-moved",
      "release #9",
    ]);
    expect(observed.out.at(-1)).toBe("github lap: batch landed 3 of 3 on one lap");
    expect(observed.disposed.at(-1)).toBe("lock");
    expect(observed.receipts.at(-1)!.batch!.map((link) => link.number)).toEqual([7, 8, 9]);
  });

  it("hands a member's own codex-loop-incomplete to its merge alone, never to another member's", async () => {
    const observed = observe();
    const capped = ["--codex-loop-incomplete", "8=cap Codex review at two passes, yes, 11 Nov: r1-02 left"];
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--land", ...capped] })).toBe(0);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual([
      "merge #7 acknowledging none",
      "merge #8 acknowledging base-moved,codex-loop-incomplete",
      "merge #9 acknowledging base-moved",
    ]);
  });

  it("lands nothing when the one lap is red, and posts the failure on every member", async () => {
    const observed = observe();
    const first = lapPlan()[0]!.id;
    const deps = depsFor({ observed, red: [first, `${first}.retry`] });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing).toEqual([]);
    for (const number of MEMBERS) {
      expect(statesOn({ number, observed }).slice(2)).toEqual(["failure", "failure"]);
    }
  });

  it("refuses a member whose squash conflicts with the ones before it, before anything posts or runs", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ conflictAt: 8, observed }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.posted).toEqual([]);
    expect(observed.ran).toEqual([]);
    expect(observed.diagnostic).toContain(
      "github lap: refused — #8 conflicts with the members before it over the base, in shared.ts; land it in a later batch or rebase it",
    );
  });

  it("stops before the lap when a member would restore older content, naming the path and the commit", async () => {
    const observed = observe();
    const reverts = { 8: [{ path: "src/a.ts", restoresBaseCommit: "abcdef0123456789abcdef0123456789abcdef01" }] };
    expect(await runGithubLap({ deps: depsFor({ observed, reverts }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.posted).toEqual([]);
    expect(observed.ran).toEqual([]);
    expect(observed.landing).toEqual([]);
    expect(observed.diagnostic).toContain(
      "github lap: refused — #8 would restore content the base or a member before it once held, in src/a.ts " +
        "(restores abcdef0123), which its merge refuses as reverts-main: rebase it over what it undoes, or lap it " +
        "alone with --acknowledge <path> if the revert is meant",
    );
  });

  it("refuses members that target different base branches", async () => {
    const observed = observe();
    const deps = depsFor({ bases: { 7: "main", 8: "feature", 9: "main" }, observed });
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic[0]!.startsWith("github lap: refused — a batch lands on ONE base branch")).toBe(true);
  });

  it("stops when a landing is not the tree it simulated, and fails the members it never landed", async () => {
    const observed = observe();
    const deps = depsFor({ landedTree: { 8: sha({ tag: "wrong" }) }, observed });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual([
      "merge #7 acknowledging none",
      "merge #8 acknowledging base-moved",
    ]);
    expect(statesOn({ number: 8, observed })).toEqual(["pending", "pending", "success", "success"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.out.at(-1)).toBe("github lap: batch landed 2 of 3 on one lap");
    expect(observed.disposed.at(-1)).toBe("lock");
  });

  it("counts a member its merge exit called failed when the base carries it as predicted, and stops", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ mergeExit: { 7: 1 }, observed }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual(["merge #7 acknowledging none"]);
    expect(statesOn({ number: 7, observed })).toEqual(["pending", "pending", "success", "success"]);
    expect(statesOn({ number: 8, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.diagnostic).toContain(
      `github lap: batch stopped — #7's merge reported exit 1, yet the base now carries it as predicted (${sha({ tag: "m7" }).slice(0, 10)})`,
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("counts an unpredicted landing whose merge exit failed by GitHub's own state, never failing it", async () => {
    const observed = observe();
    const deps = depsFor({ landedTree: { 8: sha({ tag: "wrong" }) }, mergeExit: { 8: 1 }, observed });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(statesOn({ number: 8, observed })).toEqual(["pending", "pending", "success", "success"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.diagnostic).toContain(
      "github lap: batch stopped — GitHub records #8 merged at 2026-11-11T03:00:00Z, so it counts as landed",
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 2 of 3 on one lap");
  });

  it("reads the merge record from REST alone, so a failed paired read never hides a landing", async () => {
    const observed = observe();
    const landedTree = { 8: sha({ tag: "wrong" }) };
    const deps = depsFor({ landedTree, mergeExit: { 8: 1 }, observed, pairedReadDown: true });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.diagnostic).toContain(
      "github lap: batch stopped — GitHub records #8 merged at 2026-11-11T03:00:00Z, so it counts as landed",
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 2 of 3 on one lap");
  });

  it("fails an unpredicted landing GitHub cannot confirm even when its merge exited 0, so no green outlives the stop", async () => {
    const observed = observe();
    const deps = depsFor({ landedTree: { 8: sha({ tag: "wrong" }) }, observed, recordDownAt: 8 });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(statesOn({ number: 8, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.diagnostic).toContain(
      "github lap: batch stopped — #8's state could not be read (rest rate limited), so nothing confirms its merge (exit 0) and it is posted failed; read it on GitHub before landing it again",
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("counts a member closed WITHOUT merging as not landed when another commit moved the base, failing it", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, slippedAt: 8 }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(statesOn({ number: 8, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.diagnostic).toContain(
      "github lap: batch stopped — GitHub records no merge of #8 (closed), so it counts as not landed",
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("never merges a member retargeted after the lap, since its refetch reads the old base by name", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, retargetAt: 8 }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual(["merge #7 acknowledging none"]);
    expect(observed.diagnostic).toContain(
      "github lap: batch stopped — #8 now targets release, not main, the base the lap tested it over",
    );
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("counts a refused merge as not landed when the base never moved, and fails it with the rest", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed, refusedAt: 8 }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(statesOn({ number: 8, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("stops before merging a member whose base-moved path it also changes", async () => {
    const observed = observe();
    const deps = depsFor({ changed: { 8: ["a.ts"] }, moved: { 8: ["a.ts"] }, observed });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing).toEqual(["hold #7", "merge #7 acknowledging none", "release #7"]);
    expect(statesOn({ number: 8, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(statesOn({ number: 9, observed }).slice(4)).toEqual(["failure", "failure"]);
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("stops before merging a member whose paths over the real tip drifted from its simulated link's", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ driftAt: 8, observed }), rest: [...ARGS, "--land"] })).toBe(1);
    expect(observed.landing.filter((line) => line.startsWith("merge"))).toEqual(["merge #7 acknowledging none"]);
    expect(observed.out.at(-1)).toBe("github lap: batch landed 1 of 3 on one lap");
  });

  it("prints the chain on a dry run and posts, runs and lands nothing", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--dry-run"] })).toBe(0);
    expect(observed.posted).toEqual([]);
    expect(observed.ran).toEqual([]);
    expect(observed.landing).toEqual([]);
    expect(observed.out).toContain(`github lap: #8 at h800000000 squashes to tree t800000000 (simulated s800000000)`);
  });

  it("refuses --land-only with a batch", async () => {
    const observed = observe();
    expect(await runGithubLap({ deps: depsFor({ observed }), rest: [...ARGS, "--land-only"] })).toBe(2);
    expect(observed.posted).toEqual([]);
  });
});

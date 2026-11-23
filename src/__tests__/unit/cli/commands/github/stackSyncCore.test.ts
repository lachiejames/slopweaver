import { describe, expect, it } from "vitest";
import { GithubVerbErrors, githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import {
  type GithubStackSyncEntryFact,
  githubStackSyncDoorRequest,
  githubStackSyncPlan,
  githubStackSyncReportLines,
  parseGithubStackSyncArgs,
} from "../../../../../cli/commands/github/stackSyncCore.js";
import { err, ok, unwrapErr } from "../../../../../lib/result.js";

function entry(over: Partial<GithubStackSyncEntryFact> & { position: number }): GithubStackSyncEntryFact {
  return {
    baseBranch: over.position === 1 ? "main" : `entry-${String(over.position - 1)}`,
    baseIsAncestorOfHead: true,
    branch: `entry-${String(over.position)}`,
    commits: 1,
    headSha: `sha-${String(over.position)}`,
    merged: false,
    pullRequestNumber: 100 + over.position,
    registered: true,
    stackNumber: 5,
    worktreeHeadSha: `sha-${String(over.position)}`,
    worktreePath: `/wt-${String(over.position)}`,
    ...over,
  };
}

describe("parseGithubStackSyncArgs", () => {
  it("defaults to origin and a real sync", () => {
    expect(parseGithubStackSyncArgs({ argv: [] })).toEqual(
      ok({ cwd: undefined, dryRun: false, home: undefined, remote: "origin" }),
    );
  });

  it("parses every documented override", () => {
    expect(
      parseGithubStackSyncArgs({ argv: ["--cwd", "/repo", "--remote", "upstream", "--home", "/state", "--dry-run"] }),
    ).toEqual(ok({ cwd: "/repo", dryRun: true, home: "/state", remote: "upstream" }));
  });

  it("refuses a blank --remote", () => {
    expect(parseGithubStackSyncArgs({ argv: ["--remote", ""] })).toEqual(
      err(GithubVerbErrors.remoteBlank({ got: "" })),
    );
  });

  it("refuses an unknown flag", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubStackSyncArgs({ argv: ["--unknown"] })) })).toEqual([
      "unknown flag: --unknown",
    ]);
  });
});

describe("githubStackSyncPlan", () => {
  it("plans nothing when every entry's base is already an ancestor of its head", () => {
    const plan = githubStackSyncPlan({
      entries: [entry({ position: 1 }), entry({ position: 2 }), entry({ position: 3 })],
    });
    expect(plan).toEqual({ residue: [], steps: [] });
  });

  it("plans the bottom entry alone when only it has moved", () => {
    const plan = githubStackSyncPlan({
      entries: [entry({ baseIsAncestorOfHead: false, position: 1 }), entry({ position: 2 }), entry({ position: 3 })],
    });
    expect(plan.residue).toEqual([]);
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps.map((s) => s.reason)).toEqual(["base-moved", "propagated", "propagated"]);
    expect(plan.steps.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("propagates from a middle entry, leaving the bottom entry alone", () => {
    const plan = githubStackSyncPlan({
      entries: [entry({ position: 1 }), entry({ baseIsAncestorOfHead: false, position: 2 }), entry({ position: 3 })],
    });
    expect(plan.steps.map((s) => s.position)).toEqual([2, 3]);
    expect(plan.steps.map((s) => s.reason)).toEqual(["base-moved", "propagated"]);
  });

  it("plans multiple independent stacks separately", () => {
    const plan = githubStackSyncPlan({
      entries: [
        entry({ baseIsAncestorOfHead: false, position: 1, stackNumber: 1 }),
        entry({ baseIsAncestorOfHead: true, position: 1, stackNumber: 2 }),
      ],
    });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.stackNumber).toBe(1);
  });

  it("reports a merged entry as residue without breaking the chain above it", () => {
    const plan = githubStackSyncPlan({
      entries: [entry({ merged: true, position: 1 }), entry({ baseIsAncestorOfHead: false, position: 2 })],
    });
    expect(plan.residue).toEqual(["stack #5 position 1 (PR #101) is merged"]);
    expect(plan.steps.map((s) => s.position)).toEqual([2]);
  });

  it("stops planning the rest of a stack at an unregistered entry", () => {
    const plan = githubStackSyncPlan({
      entries: [
        entry({ baseIsAncestorOfHead: false, position: 1, registered: false }),
        entry({ baseIsAncestorOfHead: false, position: 2 }),
      ],
    });
    expect(plan.steps).toEqual([]);
    expect(plan.residue).toEqual([
      "stack #5 position 1 (PR #101) is not registered in local stack state — refusing to plan the rest of this stack above it",
    ]);
  });

  it("stops planning the rest of a stack at an entry with no resolvable worktree", () => {
    const plan = githubStackSyncPlan({
      entries: [
        entry({ baseIsAncestorOfHead: false, position: 1, worktreePath: undefined }),
        entry({ baseIsAncestorOfHead: false, position: 2 }),
      ],
    });
    expect(plan.steps).toEqual([]);
    expect(plan.residue).toEqual([
      "stack #5 position 1 (PR #101) has no resolvable worktree — refusing to plan the rest of this stack above it",
    ]);
  });
});

describe("githubStackSyncReportLines", () => {
  it("names when nothing needs syncing", () => {
    expect(githubStackSyncReportLines({ plan: { residue: [], steps: [] } })).toEqual([
      "nothing to sync: every stack you're part of is already based on its live parent.",
    ]);
  });

  it("describes each step and every residue line", () => {
    const plan = githubStackSyncPlan({
      entries: [entry({ baseIsAncestorOfHead: false, position: 1 }), entry({ merged: true, position: 2 })],
    });
    expect(githubStackSyncReportLines({ plan })).toEqual([
      "would rebase entry-1 (PR #101, stack #5 position 1) onto main — base-moved",
      "residue: stack #5 position 2 (PR #102) is merged",
    ]);
  });
});

describe("githubStackSyncDoorRequest", () => {
  it("names the branches and stacks without a credential", () => {
    const plan = githubStackSyncPlan({ entries: [entry({ baseIsAncestorOfHead: false, position: 1 })] });
    expect(githubStackSyncDoorRequest({ home: "/home", plan })).toEqual({
      action: { kind: "verb", noun: "github", verb: "stack sync" },
      artifact: { branches: ["entry-1"], stackNumbers: [5] },
      meta: { createsWorkItem: false, effect: "external-write", home: "/home", requiresApproval: false },
    });
  });
});

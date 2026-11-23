import { describe, expect, it } from "vitest";

import {
  planStackSubmit,
  refHolding,
  type SubmitFact,
  submitRefusalLines,
} from "../../../../../cli/commands/github/stackSubmitCore.js";
import { PR_STATE_VERSION, type PrState, type PrStateEntry } from "../../../../../outbound/github/prStateCore.js";

describe("refHolding", () => {
  it("names a ref that holds no commit as nothing", () => {
    expect(refHolding({ sha: undefined })).toBe("nothing");
  });

  it("names the commit a ref holds", () => {
    expect(refHolding({ sha: "abc123" })).toBe("abc123");
  });
});

/** One recorded row, defaulted to a ready one so each test states only what it varies. */
const entry = (over: Partial<PrStateEntry> & { number: number; headRef: string }): PrStateEntry => ({
  baseRef: "main",
  kind: "pull-request",
  localBranchSha: null,
  observedBaseSha: "base",
  preparation: { kind: "ready", preparedRef: `refs/staged/${over.headRef}`, preparedSha: `new-${over.headRef}` },
  remoteHeadSha: `old-${over.headRef}`,
  ...over,
});

const snapshot = ({ entries }: { entries: readonly PrStateEntry[] }): PrState => ({
  entries,
  header: {
    generationId: "gen-1",
    kind: "header",
    recordedAtIso: "2026-09-09T21:00:00.000Z",
    repo: "lachiejames/slopweaver",
    version: PR_STATE_VERSION,
  },
});

/** What the shell would measure for a row nothing has disturbed. */
const fact = (over: Partial<SubmitFact> & { number: number; headRef: string }): SubmitFact => ({
  baseRef: "main",
  liveHeadSha: `old-${over.headRef}`,
  stagedSha: `new-${over.headRef}`,
  ...over,
});

describe("planStackSubmit", () => {
  it("plans a push per ready row, with the live head as the lease", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", number: 1 })],
      force: false,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(issues).toEqual([]);
    expect(plan!.pushes).toEqual([
      { branch: "one", expectedRemoteSha: "old-one", pullRequestNumber: 1, toSha: "new-one" },
    ]);
  });

  it("pushes a stack bottom-up, parent before child", () => {
    const state = snapshot({
      entries: [
        entry({ baseRef: "two", headRef: "three", number: 3 }),
        entry({ headRef: "one", number: 1 }),
        entry({ baseRef: "one", headRef: "two", number: 2 }),
      ],
    });
    const facts = [
      fact({ baseRef: "two", headRef: "three", number: 3 }),
      fact({ headRef: "one", number: 1 }),
      fact({ baseRef: "one", headRef: "two", number: 2 }),
    ];

    const { plan } = planStackSubmit({ facts, force: false, state });

    expect(plan!.pushes.map((push) => push.branch)).toEqual(["one", "two", "three"]);
  });

  it("pushes NOTHING when one row of a whole forest is blocked", () => {
    const state = snapshot({
      entries: [
        entry({ headRef: "fine", number: 1 }),
        entry({ headRef: "bad", number: 2, preparation: { kind: "blocked", reason: "its replay conflicted" } }),
        entry({ headRef: "also-fine", number: 3 }),
      ],
    });
    const facts = [
      fact({ headRef: "fine", number: 1 }),
      fact({ headRef: "bad", number: 2, stagedSha: undefined }),
      fact({ headRef: "also-fine", number: 3 }),
    ];

    const { plan, issues } = planStackSubmit({ facts, force: false, state });

    expect(plan).toBe(undefined);
    expect(issues.map((issue) => issue.code)).toEqual(["NOT_PREPARED"]);
    expect(issues[0]!.message).toContain("its replay conflicted");
  });

  it("skips an unchanged row rather than pushing it, and still submits the rest", () => {
    const state = snapshot({
      entries: [
        entry({ headRef: "settled", number: 1, preparation: { kind: "unchanged" } }),
        entry({ headRef: "moved", number: 2 }),
      ],
    });
    const facts = [
      fact({ headRef: "settled", number: 1, stagedSha: undefined }),
      fact({ headRef: "moved", number: 2 }),
    ];

    const { plan, issues } = planStackSubmit({ facts, force: false, state });

    expect(issues).toEqual([]);
    expect(plan!.pushes.map((push) => push.branch)).toEqual(["moved"]);
  });

  it("refuses a branch someone else pushed to, and says so by name", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", liveHeadSha: "somebody-elses-commit", number: 1 })],
      force: false,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(plan).toBe(undefined);
    expect(issues.map((issue) => issue.code)).toEqual(["REMOTE_MOVED"]);
    expect(issues[0]!.message).toContain("someone else pushed to it");
  });

  it("--force waives exactly that, and leases against what the remote actually holds now", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", liveHeadSha: "somebody-elses-commit", number: 1 })],
      force: true,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(issues).toEqual([]);
    expect(plan!.pushes[0]!.expectedRemoteSha).toBe("somebody-elses-commit");
    expect(plan!.waived.map((issue) => issue.code)).toEqual(["REMOTE_MOVED"]);
  });

  it("--force does NOT waive a staged ref that moved", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", number: 1, stagedSha: "something-else" })],
      force: true,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(plan).toBe(undefined);
    expect(issues.map((issue) => issue.code)).toEqual(["STAGED_REF_MOVED"]);
  });

  it("--force does NOT waive a branch the remote no longer has", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", liveHeadSha: undefined, number: 1 })],
      force: true,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(plan).toBe(undefined);
    expect(issues.map((issue) => issue.code)).toEqual(["REMOTE_REF_MISSING"]);
  });

  it("--force does NOT waive a changed inventory", () => {
    const { plan, issues } = planStackSubmit({
      facts: [fact({ headRef: "one", number: 1 }), fact({ headRef: "brand-new", number: 9 })],
      force: true,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(plan).toBe(undefined);
    expect(issues.map((issue) => issue.code)).toEqual(["INVENTORY_CHANGED"]);
    expect(issues[0]!.message).toContain("has never seen it");
  });

  it("names a recorded pull request that is no longer open", () => {
    const { issues } = planStackSubmit({
      facts: [],
      force: false,
      state: snapshot({ entries: [entry({ headRef: "gone", number: 4 })] }),
    });

    expect(issues.map((issue) => issue.code)).toEqual(["INVENTORY_CHANGED"]);
    expect(issues[0]!.message).toContain("no longer open");
  });

  it("names a pull request that was retargeted under the snapshot", () => {
    const { issues } = planStackSubmit({
      facts: [fact({ baseRef: "release-9", headRef: "one", number: 1 })],
      force: false,
      state: snapshot({ entries: [entry({ headRef: "one", number: 1 })] }),
    });

    expect(issues.map((issue) => issue.code)).toEqual(["INVENTORY_CHANGED"]);
    expect(issues[0]!.message).toContain("onto release-9 now");
  });

  it("collects EVERY issue rather than stopping at the first", () => {
    const state = snapshot({
      entries: [
        entry({ headRef: "moved", number: 1 }),
        entry({ headRef: "stale-stage", number: 2 }),
        entry({ headRef: "blocked", number: 3, preparation: { kind: "blocked", reason: "conflicted" } }),
      ],
    });
    const facts = [
      fact({ headRef: "moved", liveHeadSha: "elsewhere", number: 1 }),
      fact({ headRef: "stale-stage", number: 2, stagedSha: "gone" }),
      fact({ headRef: "blocked", number: 3, stagedSha: undefined }),
    ];

    const { issues } = planStackSubmit({ facts, force: false, state });

    expect(issues.map((issue) => issue.code).toSorted()).toEqual(["NOT_PREPARED", "REMOTE_MOVED", "STAGED_REF_MOVED"]);
  });

  it("plans nothing at all, and refuses nothing, for an operator with no open pull requests", () => {
    const { plan, issues } = planStackSubmit({ facts: [], force: false, state: snapshot({ entries: [] }) });

    expect(issues).toEqual([]);
    expect(plan!.pushes).toEqual([]);
  });
});

describe("submitRefusalLines", () => {
  it("counts the problems, names each, and says nothing was pushed", () => {
    const lines = submitRefusalLines({
      issues: [{ branch: "one", code: "NOT_PREPARED", message: "#1 (one) is not prepared: conflicted" }],
    });

    expect(lines).toEqual([
      "refused: 1 problem(s) stand between your local state and the remote, so NOTHING was pushed.",
      "  [NOT_PREPARED] #1 (one) is not prepared: conflicted",
    ]);
  });

  it("points at --force only when a moved remote is among the reasons", () => {
    const lines = submitRefusalLines({ issues: [{ branch: "one", code: "REMOTE_MOVED", message: "moved" }] });

    expect(lines[2]).toContain("--force accepts");
  });
});

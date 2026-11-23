/**
 * `handover park --wake-on-checks` never closes a seat on its own open pull request (waiting
 * for CI, rebasing, fixing red CI and landing the PR are the work). The judge is pure; every case names its verdict.
 */
import { describe, expect, it } from "vitest";

import { checksParkRefusalDetail, judgeChecksPark } from "../../../handover/ownLandingPark.js";
import type { ParkWake } from "../../../handover/parkWake.js";
import { err, ok } from "../../../lib/result.js";
import { GithubLiveErrors } from "../../../live/github/errors.js";

const WAKE: ParkWake = { kind: "checks", number: 3454, repo: "acme/widgets" };
const RUN_BRANCHES = ["a-talk-relay-start-branch", "fix-relay"];

describe("judgeChecksPark", () => {
  it("refuses the run's own open pull request, matched on the branch it started on", () => {
    const head = ok({ headRefName: "a-talk-relay-start-branch", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE })).toEqual({
      branch: "a-talk-relay-start-branch",
      kind: "own-landing",
      target: "acme/widgets#3454",
    });
  });

  it("refuses the run's own open pull request, matched on the branch its worktree has out now", () => {
    const head = ok({ headRefName: "fix-relay", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE }).kind).toBe(
      "own-landing",
    );
  });

  it("lets a seat park on another branch's open pull request — waiting on somebody else's work is idle", () => {
    const head = ok({ headRefName: "stack-parent", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE })).toEqual({
      kind: "may-park",
    });
  });

  it("keeps the seat on an unmatched open pull request when the worktree's branch did not read", () => {
    const head = ok({ headRefName: "fix-relay", state: "OPEN" as const });
    expect(
      judgeChecksPark({
        branchUnread: "the worktree's branch did not read: git exited 128",
        head,
        runBranches: ["old-branch"],
        wake: WAKE,
      }),
    ).toEqual({
      kind: "unread",
      reason: "the worktree's branch did not read: git exited 128",
      target: "acme/widgets#3454",
    });
  });

  it("still names its own landing when the recorded branch matches though the worktree's did not read", () => {
    const head = ok({ headRefName: "old-branch", state: "OPEN" as const });
    expect(
      judgeChecksPark({ branchUnread: "git exited 128", head, runBranches: ["old-branch"], wake: WAKE }).kind,
    ).toBe("own-landing");
  });

  it("lets a seat park on its own pull request once it merged or closed — the landing is over", () => {
    const merged = ok({ headRefName: "fix-relay", state: "MERGED" as const });
    const closed = ok({ headRefName: "fix-relay", state: "CLOSED" as const });
    expect([
      judgeChecksPark({ branchUnread: undefined, head: merged, runBranches: RUN_BRANCHES, wake: WAKE }).kind,
      judgeChecksPark({ branchUnread: undefined, head: closed, runBranches: RUN_BRANCHES, wake: WAKE }).kind,
    ]).toEqual(["may-park", "may-park"]);
  });

  it("keeps the seat when the head could not be read — absence never reads as somebody else's", () => {
    const head = err(GithubLiveErrors.readFailed({ message: "rate limited" }));
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE })).toEqual({
      kind: "unread",
      reason: "rate limited",
      target: "acme/widgets#3454",
    });
  });

  it("keeps the seat when no head was read for a checks wake", () => {
    expect(
      judgeChecksPark({ branchUnread: undefined, head: undefined, runBranches: RUN_BRANCHES, wake: WAKE }).kind,
    ).toBe("unread");
  });

  it("keeps the seat on an open pull request when the run records no branch — nothing proves it somebody else's", () => {
    const head = ok({ headRefName: "fix-relay", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: [], wake: WAKE })).toEqual({
      kind: "unread",
      reason: "this run records no branch to compare its head with",
      target: "acme/widgets#3454",
    });
  });

  it("matches a head whose name ends in whitespace the worktree read trimmed away", () => {
    const head = ok({ headRefName: "fix-relay ", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE }).kind).toBe(
      "own-landing",
    );
  });

  it("compares branches exactly, case included", () => {
    const head = ok({ headRefName: "Fix-Relay", state: "OPEN" as const });
    expect(judgeChecksPark({ branchUnread: undefined, head, runBranches: RUN_BRANCHES, wake: WAKE }).kind).toBe(
      "may-park",
    );
  });

  it("judges nothing for a clock wake or no wake — only a checks wake reads a head", () => {
    expect([
      judgeChecksPark({
        branchUnread: undefined,
        head: undefined,
        runBranches: RUN_BRANCHES,
        wake: { atIso: "2026-11-09T03:00:00Z", kind: "at" },
      }).kind,
      judgeChecksPark({ branchUnread: undefined, head: undefined, runBranches: RUN_BRANCHES, wake: undefined }).kind,
    ]).toEqual(["may-park", "may-park"]);
  });
});

describe("checksParkRefusalDetail", () => {
  it("names the branch and the one background wait that keeps the seat working", () => {
    expect(
      checksParkRefusalDetail({
        judgement: { branch: "fix-relay", kind: "own-landing", target: "acme/widgets#3454" },
      }),
    ).toBe(
      "acme/widgets#3454 is open on fix-relay, this run's own branch — its CI, a rebase, a red-CI fix and the landing " +
        "are the work, so keep the seat and run slopweaver github checks --number 3454 --repo acme/widgets --wait as " +
        "a background job, or --until merge once it is queued",
    );
  });

  it("names the failed read when whose pull request it is could not be told", () => {
    expect(
      checksParkRefusalDetail({ judgement: { kind: "unread", reason: "rate limited", target: "acme/widgets#3454" } }),
    ).toBe(
      "acme/widgets#3454 could not be told apart from this run's own landing (rate limited) — keep the seat and run " +
        "slopweaver github checks --number 3454 --repo acme/widgets --wait as a background job, or --until merge " +
        "once it is queued",
    );
  });
});
